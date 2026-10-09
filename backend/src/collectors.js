import { collectSelfHosted } from './selfhosted-scraper.js';

import { config } from './settings.js';
import { normalizeVideo } from './core.js';
import { normalizeMetaAd } from './meta-adapter.js';
import { collectScrapeCreators } from './scrapecreators-client.js';

const wait = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const RETRYABLE_HTTP_STATUSES = new Set([
  408,
  429,
  500,
  502,
  503,
  504
]);

function cleanInstagramQuery(query) {
  return String(query || '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function cleanQuery(query) {
  return String(query || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLimit(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? Math.min(100, Math.floor(number))
    : 30;
}

function normalizeOffset(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : 0;
}

function selectedProvider() {
  return String(
    process.env.VIDEO_PROVIDER || 'apify'
  ).trim().toLowerCase();
}

function demo(platform, query, offset, limit) {
  return Array.from({ length: limit }, (_, index) => {
    const n = offset + index + 1;

    return normalizeVideo(
      {
        id: `demo-${platform}-${query}-${n}`,
        url: `https://example.com/demo/${platform}/${n}`,
        caption: `DEMO ONLY: ${query} creative concept ${n}`,
        thumbnail:
          `https://placehold.co/480x600/171f34/ffffff` +
          `?text=DEMO+${platform}+${n}`,
        timestamp: new Date(
          Date.now() - n * 86400000
        ).toISOString()
      },
      platform
    );
  }).filter(Boolean);
}

function buildApifyInput(
  platform,
  query,
  offset,
  limit
) {
  const template = platform === 'instagram'
    ? process.env.INSTAGRAM_ACTOR_INPUT
    : process.env.META_ACTOR_INPUT;

  if (!template) {
    throw new Error(
      `${platform} provider configuration missing: actor input`
    );
  }


  try {
    return JSON.parse(
      template
        .replaceAll(
          '{{QUERY}}',
          JSON.stringify(query).slice(1, -1)
        )
        .replaceAll('{{LIMIT}}', String(limit))
        .replaceAll('{{OFFSET}}', String(offset))
    );
  } catch {
    throw new Error(
      `Invalid ${platform} actor JSON input template`
    );
  }
}

function isRetryable(error) {
  if (error?.retryable === true) return true;

  const message = String(error?.message || error);

  return /timeout|timed out|fetch failed|network error|ECONNRESET|ETIMEDOUT/i
    .test(message);
}

function providerError(status, message) {
  const error = new Error(message);

  error.status = status;
  error.retryable = RETRYABLE_HTTP_STATUSES.has(status);

  return error;
}

function normalizeApifyResults(platform, data) {
  if (!Array.isArray(data)) {
    throw new Error(
      `${platform}: provider returned a non-array dataset`
    );
  }

  const normalized = data
    .map(item => {
      if (platform === 'meta') {
        return normalizeMetaAd(item);
      }

      return normalizeVideo(item, platform);
    })
    .flat()
    .filter(Boolean);

  const seen = new Set();

  return normalized.filter(video => {
    if (!video?.identity) return false;

    if (seen.has(video.identity)) return false;

    seen.add(video.identity);
    return true;
  });
}

async function collectApify(
  platform,
  query,
  offset,
  limit
) {
  const actor = platform === 'instagram'
    ? config.instagramActor
    : config.metaActor;

  if (!config.apifyToken || !actor) {
    throw new Error(
      `${platform} provider configuration missing`
    );
  }

  const actorQuery = platform === 'instagram'
    ? cleanInstagramQuery(query)
    : cleanQuery(query);

  if (!actorQuery) {
    throw new Error(
      `${platform}: search query is empty after cleaning`
    );
  }

  const body = buildApifyInput(
    platform,
    actorQuery,
    offset,
    limit
  );

  const url =
    `https://api.apify.com/v2/acts/` +
    `${encodeURIComponent(actor)}` +
    `/run-sync-get-dataset-items` +
    `?timeout=120&memory=1024`;

  const maxAttempts = 2;
  let lastError;

  for (
    let attempt = 0;
    attempt < maxAttempts;
    attempt++
  ) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apifyToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(125000)
      });

      if (!response.ok) {
        const detail = (
          await response.text()
        ).slice(0, 500);

        if (
          response.status === 403 &&
          /Monthly usage hard limit exceeded/i.test(detail)
        ) {
          throw providerError(
            403,
            'Apify monthly usage hard limit exceeded. ' +
            'Use ScrapeCreators or restore your Apify allowance.'
          );
        }

        throw providerError(
          response.status,
          `Provider HTTP ${response.status}: ${detail}`
        );
      }

      const data = await response.json();

      const videos = normalizeApifyResults(
        platform,
        data
      );

      console.log(JSON.stringify({
        event: 'provider_batch',
        provider: 'apify',
        platform,
        query: actorQuery,
        offset,
        rawCount: data.length,
        normalizedCount: videos.length,
        attempt: attempt + 1
      }));

      return videos;
    } catch (error) {
      lastError = error;

      console.warn(JSON.stringify({
        event: 'provider_attempt_failed',
        provider: 'apify',
        platform,
        attempt: attempt + 1,
        error: String(error.message).slice(0, 300)
      }));

      if (
        attempt >= maxAttempts - 1 ||
        !isRetryable(error)
      ) {
        break;
      }

      await wait(1500 * (2 ** attempt));
    }
  }

  throw lastError;
}

async function collectFromScrapeCreators(
  platform,
  query,
  offset,
  limit
) {
  if (!process.env.SCRAPECREATORS_API_KEY) {
    throw new Error(
      'SCRAPECREATORS_API_KEY missing in backend/.env'
    );
  }

  const providerQuery = platform === 'instagram'
    ? cleanInstagramQuery(query)
    : cleanQuery(query);

  if (!providerQuery) {
    throw new Error(
      `${platform}: search query is empty after cleaning`
    );
  }

  const maxAttempts = 2;
  let lastError;

  for (
    let attempt = 0;
    attempt < maxAttempts;
    attempt++
  ) {
    try {
      const videos = await collectScrapeCreators(
        platform,
        providerQuery,
        offset,
        limit
      );

      if (!Array.isArray(videos)) {
        throw new Error(
          'ScrapeCreators collector returned invalid data'
        );
      }

  
      const seen = new Set();

      const normalized = videos.filter(video => {
        if (
          !video ||
          !video.identity ||
          !video.url ||
          video.platform !== platform
        ) {
          return false;
        }

        if (seen.has(video.identity)) {
          return false;
        }

        seen.add(video.identity);
        return true;
      });

      console.log(JSON.stringify({
        event: 'provider_batch',
        provider: 'scrapecreators',
        platform,
        query: providerQuery,
        offset,
        rawCount: videos.length,
        normalizedCount: normalized.length,
        attempt: attempt + 1
      }));

      return normalized;
    } catch (error) {
      lastError = error;

      console.warn(JSON.stringify({
        event: 'provider_attempt_failed',
        provider: 'scrapecreators',
        platform,
        attempt: attempt + 1,
        error: String(error.message).slice(0, 300)
      }));

      const message = String(
        error?.message || error
      );

      if (
        /HTTP (401|402|403)|insufficient credits|quota exceeded|API_KEY missing/i
          .test(message)
      ) {
        break;
      }

      if (
        attempt >= maxAttempts - 1 ||
        !isRetryable(error)
      ) {
        break;
      }

      await wait(1500 * (2 ** attempt));
    }
  }

  throw lastError;
}


export async function collect(
  platform,
  query,
  offset = 0,
  limit = 60
) {
  if (!['instagram', 'meta'].includes(platform)) {
    throw new Error(
      `Unsupported video platform: ${platform}`
    );
  }

  const safeOffset = normalizeOffset(offset);
  const safeLimit = normalizeLimit(limit);

  if (config.demo) {
    return demo(
      platform,
      query,
      safeOffset,
      safeLimit
    );
  }

  const provider = selectedProvider();

  if (provider === 'selfhosted') {
    return collectSelfHosted(platform, query, safeOffset, safeLimit);
  }

  if (provider === 'scrapecreators') {
    return collectFromScrapeCreators(
      platform,
      query,
      safeOffset,
      safeLimit
    );
  }

  if (provider === 'apify') {
    return collectApify(
      platform,
      query,
      safeOffset,
      safeLimit
    );
  }

  throw new Error(
    `Unsupported VIDEO_PROVIDER: ${provider}. ` +
    'Use "selfhosted", "scrapecreators" or "apify".'
  );
}
