
const API = 'https://api.scrapecreators.com';

const timeout = () => {
  const value = Number(
    process.env.SCRAPECREATORS_TIMEOUT_MS || 60000
  );

  return Number.isFinite(value)
    ? Math.max(5000, Math.min(120000, value))
    : 60000;
};

function optionalString(value) {
  return typeof value === 'string' ? value : '';
}

function firstString(...values) {
  return values.find(
    value => typeof value === 'string' && value.trim()
  ) || '';
}

async function request(path, params) {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;

  if (!apiKey) {
    throw new Error('SCRAPECREATORS_API_KEY missing');
  }

  const url = new URL(path, API);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  let response;

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(timeout())
    });
  } catch (error) {
    throw new Error(
      `ScrapeCreators network error: ${error.message}`
    );
  }

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `ScrapeCreators HTTP ${response.status}: ` +
      detail.slice(0, 250)
    );
  }

  const data = await response.json();

  if (!data || data.success === false) {
    throw new Error(
      'ScrapeCreators returned an unsuccessful response'
    );
  }

  return data;
}

function normalizeInstagram(reel) {
  const url = firstString(reel.url, reel.permalink);

  // This integration intentionally accepts confirmed
  // /reel/ links rather than ordinary Instagram posts.
  const match = url.match(
    /^https?:\/\/(?:www\.)?instagram\.com\/reel\/([^/?#]+)/
  );

  if (!match) return null;

  const shortcode = reel.shortcode || match[1];

  return {
    platform: 'instagram',
    id: String(reel.id || shortcode),
    identity: `instagram:reel:${shortcode}`,
    url,
    caption: optionalString(reel.caption),
    thumbnail: firstString(
      reel.thumbnail_src,
      reel.thumbnail,
      reel.display_url
    ),
    videoUrl: firstString(
      reel.video_url,
      reel.videoUrl
    ),
    postedAt: reel.taken_at || reel.timestamp || null,
    mediaType: 'video',
    isConfirmedReel: true
  };
}

function normalizeMeta(ad) {
  const adId = firstString(
    String(ad.ad_archive_id || ''),
    String(ad.ad_id || '')
  );

  if (!adId) return [];

  const snapshot = ad.snapshot || {};

  const videos = [
    ...(Array.isArray(snapshot.videos)
      ? snapshot.videos
      : []),
    ...(Array.isArray(snapshot.extra_videos)
      ? snapshot.extra_videos
      : [])
  ];

  const cards = Array.isArray(snapshot.cards)
    ? snapshot.cards
    : [];

  for (const card of cards) {
    if (Array.isArray(card.videos)) {
      videos.push(...card.videos);
    }

    if (card.video) {
      videos.push(card.video);
    }
  }

  const caption = firstString(
    snapshot.body?.text,
    snapshot.caption,
    snapshot.title,
    ad.page_name
  );

  const results = [];
  const unique = new Set();

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];

    const videoUrl = firstString(
      video.video_hd_url,
      video.video_sd_url,
      video.video_url,
      video.url
    );

    const thumbnail = firstString(
      video.video_preview_image_url,
      video.thumbnail_url,
      video.thumbnail,
      video.preview_image_url
    );

    const videoId = firstString(
      String(video.video_id || ''),
      String(video.id || '')
    );

    // Do not treat still-image ads as video ads.
    if (!videoUrl && !videoId) continue;

    // Avoid duplicate creatives within the same ad.
    const key = videoId || videoUrl;

    if (unique.has(key)) continue;
    unique.add(key);

    const suffix = videoId || String(i);

    results.push({
      platform: 'meta',
      id: `${adId}:${suffix}`,
      identity: `meta:${adId}:${suffix}`,
      url:
        `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adId)}`,
      caption,
      thumbnail,
      videoUrl,
      mediaType: 'video',
      postedAt: ad.start_date || null,
      isConfirmedReel: false
    });
  }

  return results;
}

export async function collectScrapeCreators(
  platform,
  query,
  offset = 0,
  limit = 30
) {
  if (!['instagram', 'meta'].includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const cleanQuery = String(query || '').trim();

  if (!cleanQuery) {
    throw new Error('Search query is empty');
  }

  let data;
  let normalized;

  if (platform === 'instagram') {
    // The existing pipeline sends offset=0.
    // Page 1 is the first documented provider page.
    const page = Math.min(
      11,
      Math.max(1, Math.floor(offset / 10) + 1)
    );

    data = await request('/v2/instagram/reels/search', {
      query: cleanQuery,
      page
    });

    if (!Array.isArray(data.reels)) {
      throw new Error(
        'Instagram response missing reels array'
      );
    }

    normalized = data.reels
      .map(normalizeInstagram)
      .filter(Boolean);

  } else {
    data = await request(
      '/v1/facebook/adLibrary/search/ads',
      {
        query: cleanQuery,
        country:
          process.env.SCRAPECREATORS_META_COUNTRY || 'US',
        status: 'ACTIVE',
        ad_type: 'all',
        media_type: 'VIDEO'
      }
    );

    if (!Array.isArray(data.searchResults)) {
      throw new Error(
        'Meta response missing searchResults array'
      );
    }

    normalized = data.searchResults
      .flatMap(normalizeMeta);
  }

  const deduped = [
    ...new Map(
      normalized.map(video => [video.identity, video])
    ).values()
  ];

  console.log(JSON.stringify({
    event: 'scrapecreators_batch',
    platform,
    query: cleanQuery,
    rawCount: platform === 'instagram'
      ? data.reels.length
      : data.searchResults.length,
    normalizedCount: deduped.length,
    creditsRemaining: data.credits_remaining ?? null
  }));

  return deduped.slice(
    0,
    Math.max(1, Math.min(100, Number(limit) || 30))
  );
}
