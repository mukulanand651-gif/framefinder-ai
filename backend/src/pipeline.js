import { pool, updateSearch, jsonDbValue } from './db.js';
import { productFrom } from './product.js';
import { analyze, score, visionAvailable } from './vision.js';
import { collect } from './collectors.js';
import { isNearDuplicate, fingerprint, hash } from './core.js';
import { config } from './settings.js';
import { expandQueries } from './query-expansion.js';
const posInt = (value, fallback, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
};
const passes = () => posInt(process.env.MAX_SOURCE_PASSES, 2, 5);
const checks = () => posInt(process.env.MAX_VISION_CHECKS_PER_SOURCE, 8, 40);
const limit = () => posInt(process.env.APIFY_CANDIDATE_LIMIT, 30, 100);
const target = () => posInt(process.env.RESULTS_PER_SOURCE, 20, 20);
const previewLimit = () => posInt(process.env.UNVERIFIED_PREVIEW_LIMIT, 20, 40);
const clean = value => String(value ?? '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = value => clean(value).toLowerCase().split(' ').filter(w => w.length > 2);
const safeArray = value => Array.isArray(value) ? value : [];
const ignored = new Set(['unknown', 'undefined', 'null', 'none', 'product', 'n a']);
const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));
const stage = (id, name) => updateSearch(id, { stage: name });

export function buildSourceQueries(platform, product) {
  if (!['instagram', 'meta'].includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const attrs = product?.attributes || {};

  const invalid = new Set([
    'unknown', 'undefined', 'null', 'none',
    'n a', 'not available', 'product'
  ]);

  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from',
    'this', 'that', 'your', 'you',
    'buy', 'shop', 'online', 'sale',
    'free', 'offer', 'original',
    'official', 'latest', 'pack', 'pcs'
  ]);

  const normalize = value =>
    clean(
      String(value ?? '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_/]+/g, ' ')
        .replace(/\s+/g, ' ')
    ).toLowerCase().trim();

  const tokenize = value =>
    normalize(value)
      .split(' ')
      .filter(word =>
        (word.length >= 2 || /^\d+$/.test(word)) &&
        !stopWords.has(word) &&
        !invalid.has(word)
      );

  const phrase = (value, maxWords = 7) =>
    tokenize(value).slice(0, maxWords).join(' ');

  const plural = word => {
    if (!word || /^\d+$/.test(word)) return word;
    if (word.endsWith('s')) return word;
    if (/[^aeiou]y$/.test(word)) {
      return word.slice(0, -1) + 'ies';
    }
    if (/(ch|sh|x|z)$/.test(word)) return `${word}es`;
    return `${word}s`;
  };

  const singular = word => {
    if (/[^aeiou]ies$/.test(word)) {
      return word.slice(0, -3) + 'y';
    }
    if (/(ches|shes|xes|zes)$/.test(word)) {
      return word.slice(0, -2);
    }
    if (word.endsWith('s') && !word.endsWith('ss')) {
      return word.slice(0, -1);
    }
    return word;
  };

  const title = normalize(product?.title || '');
  const brand = phrase(product?.brand || attrs.brand);
  const model = phrase(product?.model || attrs.model);
  const category = phrase(attrs.productType || '');

  const titleTokens = tokenize(title);
  const brandTokens = tokenize(brand);
  const modelTokens = tokenize(model);

  const productQueries = safeArray(product?.queries)
    .filter(value => typeof value === 'string')
    .map(value => phrase(value))
    .filter(Boolean);

  const visualText = [
    ...safeArray(attrs.text),
    ...safeArray(attrs.logos)
  ]
    .filter(value => typeof value === 'string')
    .map(value => phrase(value, 4))
    .filter(Boolean);

  const proposals = [];

  const add = (...values) => {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const query = phrase(value, 8);
      if (query) proposals.push(query);
    }
  };


  const categoryTokens = category
    ? tokenize(category)
    : titleTokens.filter(word =>
        !brandTokens.includes(word) &&
        !modelTokens.includes(word)
      ).slice(-2);

  const categoryPhrase = categoryTokens.join(' ');


  const grammaticalVariants = [];

  if (titleTokens.length === 2) {
    const [modifier, subject] = titleTokens;

    grammaticalVariants.push(
      `${modifier} ${plural(subject)}`,
      `${plural(modifier)} ${plural(subject)}`,
      `${plural(subject)} for ${plural(modifier)}`
    );
  }

  const pluralCategory = categoryTokens.length
    ? [
        ...categoryTokens.slice(0, -1),
        plural(categoryTokens.at(-1))
      ].join(' ')
    : '';

  if (platform === 'instagram') {
 

    add(
      brand && pluralCategory
        ? `${brand} ${pluralCategory}`
        : '',

      brand && model
        ? `${brand} ${model}`
        : '',

      model && categoryPhrase
        ? `${model} ${categoryPhrase}`
        : '',

      ...grammaticalVariants,

      ...productQueries.map(q => phrase(q, 4)),

      brand && categoryPhrase
        ? `${brand} ${categoryPhrase}`
        : '',

      pluralCategory,

      categoryPhrase,

      titleTokens.slice(0, 3).join(' '),

      titleTokens.slice(-3).join(' '),

      title
    );

    if (categoryTokens.length) {
      add(
        singular(categoryTokens.at(-1)),
        plural(categoryTokens.at(-1))
      );
    }
  } else {
 

    add(
      brand && model ? `${brand} ${model}` : '',
      title,
      ...productQueries,
      brand && categoryPhrase
        ? `${brand} ${categoryPhrase}`
        : '',
      model && categoryPhrase
        ? `${model} ${categoryPhrase}`
        : '',
      ...visualText.map(value =>
        brand ? `${brand} ${value}` : value
      ),
      ...grammaticalVariants,
      pluralCategory,
      categoryPhrase
    );
  }

  const description = phrase(
    product?.generatedDescription ||
    product?.description ||
    '',
    5
  );

  add(description);

  // Deduplicate and remove placeholders.
  const seen = new Set();
  const output = [];

  for (const candidate of proposals) {
    const query = phrase(candidate, 8);

    if (
      query.length < 3 ||
      invalid.has(query) ||
      seen.has(query)
    ) {
      continue;
    }

    seen.add(query);
    output.push(query);
  }

  const selected = output.slice(0, 8);

  console.log(JSON.stringify({
    event: 'dynamic_source_queries',
    platform,
    productTitle: title,
    brand: brand || null,
    model: model || null,
    category: categoryPhrase || null,
    queries: selected
  }));

  return selected;
}





function relevance(product, video) {
  const text = clean([video.caption, video.title, video.adCopy].filter(Boolean).join(' ')).toLowerCase();
  const stop = new Set(['mens', 'womens', 'with', 'the', 'shoe', 'shoes', 'runner', 'running']);
  const titleWords = words(product.title).filter(w => !stop.has(w));
  const brand = clean(product.brand || product.attributes?.brand).toLowerCase();
  const model = clean(product.model || product.attributes?.model).toLowerCase();
  let points = titleWords.reduce((n, word) => n + (text.includes(word) ? 8 : 0), 0);
  if (brand && text.includes(brand)) points += 60;
  if (model && text.includes(model)) points += 70;
  for (const term of [...safeArray(product.attributes?.text), ...safeArray(product.attributes?.logos)]) {
    const normalized = clean(term).toLowerCase();
    if (normalized.length >= 5 && text.includes(normalized)) points += 25;
  }
  return points;
}
function terminal(error) {
  const msg = String(error?.message || error);
  return /(?:HTTP|Provider HTTP)\s*(401|402|403)\b|insufficient credits|monthly usage hard limit|quota exceeded|API_KEY missing|configuration missing|invalid .*actor JSON/i.test(msg);
}
function stripped(video, match, verificationStatus) {
  const item = { ...video, match, verificationStatus, fingerprint: fingerprint(video) };
  delete item._textRank;
  delete item.raw;
  delete item.videoUrl;
  return item;
}
const validMatch = value => value?.verified === true &&
  typeof value.score === 'number' && Number.isFinite(value.score) && value.score >= 0 && value.score <= 100;

async function getCachedScore(product, video) {
  const key = hash(['thumbnail-match-v3', process.env.GEMINI_MODEL || 'default',
    hash(product.image), video.identity, video.thumbnail].join('|'));
  const result = await pool.query(
    "SELECT value FROM vision_score_cache WHERE cache_key=$1 AND updated_at > now()-interval '30 days'", [key]);
  const value = result.rows[0]?.value;
  return { key, match: validMatch(value) ? value : null };
}
async function putCachedScore(key, match) {
  if (!validMatch(match)) return;
  await pool.query(
    'INSERT INTO vision_score_cache(cache_key,value) VALUES($1,$2) ON CONFLICT(cache_key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',
    [key, jsonDbValue(match)]);
}

async function runSource(id, platform, product) {
  const issues = [], chosen = [], previews = [], collected = [], seenIds = new Set();
  const stats = {
    normalizedCandidates: 0, duplicateIds: 0, nearDuplicates: 0,
    previouslySeen: 0, rejectedNonReels: 0, rejectedLowRelevance: 0,
    belowThreshold: 0, unverified: 0, accepted: 0, visionChecks: 0, cacheHits: 0, passes: 0
  };
  const queries = buildSourceQueries(platform, product);

  console.log(JSON.stringify({
    event: 'source_queries_generated',
    platform,
    searchId: id,
    queries,
    configuredPasses:
      process.env.MAX_SOURCE_PASSES
  }));

  const rounds = Math.min(queries.length, passes());
  const requireReels = process.env.REQUIRE_CONFIRMED_REELS !== 'false';
  const minRelevance = Number(process.env.MIN_TEXT_RELEVANCE || 0);
  const strict = process.env.STRICT_BRAND_TEXT_MATCH === 'true';
  const hasBrand = Boolean(clean(product.brand || product.attributes?.brand));

  for (let i = 0; i < rounds; i++) {
    const query = queries[i];
    stats.passes++;
    await stage(id, `Searching ${platform}: ${i + 1}/${rounds}`);
    let batch;

    try {
      batch = await collect(platform, query, 0, limit());

      log('source_query_success', {
        platform,
        searchId: id,
        query,
        count: Array.isArray(batch) ? batch.length : 0
      });

    } catch (error) {
      const message = String(
        error?.message || error
      ).slice(0, 240);

      const loginRestricted =
        platform === 'instagram' &&
        /requires login|login or is blocked|accounts\/login|temporarily blocked/i
          .test(message);

      issues.push(
        `${platform}: query ${i + 1} failed: ${message}`
      );

      log('source_query_failed', {
        platform,
        searchId: id,
        query,
        attempt: i + 1,
        totalQueries: rounds,
        loginRestricted,
        error: message
      });

      if (loginRestricted) {
        continue;
      }

      if (terminal(error)) {
        break;
      }
      continue;
    }

    if (!Array.isArray(batch)) { issues.push(`${platform}: invalid collector response`); continue; }
    stats.normalizedCandidates += batch.length;
    log('source_pass', { platform, searchId: id, query, count: batch.length });
    for (const video of batch) {
      if (!video?.identity || !video?.url) continue;
      if (seenIds.has(video.identity)) { stats.duplicateIds++; continue; }
      seenIds.add(video.identity);
      if (platform === 'instagram' && requireReels && video.isConfirmedReel !== true) {
        stats.rejectedNonReels++; continue;
      }
      if (collected.some(previous => isNearDuplicate(previous, video))) {
        stats.nearDuplicates++; continue;
      }
      const rank = relevance(product, video);
      if ((strict && hasBrand && rank < 60) || rank < minRelevance) {
        stats.rejectedLowRelevance++; continue;
      }
      collected.push({ ...video, _textRank: rank });
    }
  }
  collected.sort((a, b) => b._textRank - a._textRank);
  await stage(id, `Verifying ${platform} candidates`);
  const previewIds = new Set();
  const addPreview = (video, reason) => {
    if (previews.length >= previewLimit() || previewIds.has(video.identity)) return;
    previewIds.add(video.identity);
    previews.push(stripped(video, { score: null, verified: false, reason }, 'unverified'));
  };
  const canVerify = Boolean(product.image && product.visionVerified && visionAvailable());
  if (!canVerify && collected.length) log('source_verification_unavailable', {
    platform, searchId: id, hasProductImage: Boolean(product.image),
    productVisionVerified: Boolean(product.visionVerified), visionAvailable: visionAvailable()
  });

  for (const video of collected) {
    if (chosen.length >= target()) break;
    if (!canVerify || !video.thumbnail) {
      stats.unverified++;
      addPreview(video, !video.thumbnail ? 'No usable video thumbnail' : 'Reference image or Gemini unavailable');
      continue;
    }
    let match;
    try {
      const cached = await getCachedScore(product, video);
      if (cached.match) { match = cached.match; stats.cacheHits++; }
      else {
        if (stats.visionChecks >= checks()) {
          stats.unverified++; addPreview(video, 'Visual verification budget reached'); continue;
        }
        stats.visionChecks++;
        match = config.demo
          ? { verified: false, score: null, reason: 'Demo mode' }
          : await score(product, video);
        await putCachedScore(cached.key, match);
      }
    } catch (error) {
      const message = String(error?.message || error).slice(0, 180);
      log('candidate_verification_failed', { platform, searchId: id, identity: video.identity, error: message });
      stats.unverified++;
      addPreview(video, `Visual verification error: ${message}`);
      continue;
    }
    log('candidate_scored', {
      platform, searchId: id, identity: video.identity,
      score: match?.score ?? null, verified: match?.verified === true,
      reason: String(match?.reason || '').slice(0, 150)
    });
    if (!validMatch(match)) {
      stats.unverified++; addPreview(video, match?.reason || 'Visual verification unavailable'); continue;
    }
    if (match.score < config.minScore) { stats.belowThreshold++; continue; }
    // Global seen filtering AFTER comparison: cached scoring still works across product searches.
    try {
      const fp = fingerprint(video);
      const previous = await pool.query(
        'SELECT 1 FROM seen_videos WHERE platform=$1 AND (identity=$2 OR fingerprint=$3) LIMIT 1',
        [platform, video.identity, fp]);
      if (previous.rowCount) { stats.previouslySeen++; continue; }
    } catch (error) {
      log('previously_seen_lookup_failed', { platform, searchId: id, error: String(error.message || error) });
      issues.push(`${platform}: previous-seen lookup failed`);
      continue;
    }
    chosen.push(stripped(video, match, 'verified'));
    stats.accepted++;
  }
  if (chosen.length < target()) issues.push(
    `${platform}: ${chosen.length}/${target()} verified matches; ${stats.normalizedCandidates} collected, ` +
    `${stats.visionChecks} visual checks, ${stats.belowThreshold} below threshold, ${previews.length} unverified previews.`);
  log('source_filter_summary', { platform, searchId: id, ...stats, previewCount: previews.length, issues });
  return { chosen, candidatesPreview: previews, issues };
}

async function prepareProduct(job) {
  const product = await productFrom(job.input, job.image);
  log('product_reference_resolved', {
    searchId: job.id, title: product.title,
    hasReferenceImage: Boolean(product.image), referenceSource: product.referenceSource || null,
    productCandidates: product.productCandidates?.length || 0, discoveryIssue: product.discoveryIssue || null
  });
  if (!product.image) {
    const pending = await analyze(product);
    log('product_vision_ready', {
      searchId: job.id, hasReferenceImage: false,
      visionVerified: false, reason: pending.visionIssue || 'No product image'
    });
    return pending;
  }
  const key = 'vision:' + hash(product.image + '|' + (process.env.GEMINI_MODEL || 'default'));
  if (!product.cacheHit) {
    const cached = await pool.query(
      "SELECT value FROM product_cache WHERE cache_key=$1 AND updated_at > now()-interval '7 days'", [key]);
    if (cached.rows[0]?.value?.visionVerified) {
      const ready = { ...product, ...cached.rows[0].value, image: product.image, cacheHit: true };
      log('product_vision_ready', {
        searchId: job.id, hasReferenceImage: true,
        visionVerified: true, cacheHit: true
      });
      return ready;
    }
  }
  const analyzed = await analyze(product);

  const image = String(product.image || '');

  let imageHost = null;

  if (/^https?:\/\//i.test(image)) {
    try {
      imageHost = new URL(image).hostname;
    } catch {
      imageHost = 'invalid-url';
    }
  }

  console.log(JSON.stringify({
    event: 'reference_image_diagnostic',
    referenceSource: product.referenceSource,
    imageType: image.startsWith('data:image/')
      ? 'data-uri'
      : image.startsWith('blob:')
        ? 'blob-url'
        : /^https?:\/\//i.test(image)
          ? 'http-url'
          : image.startsWith('/')
            ? 'local-path'
            : 'other',
    mimeType: image.startsWith('data:image/')
      ? image.slice(0, 50).split(';')[0]
      : null,
    imageHost,
    imageLength: image.length
  }));

  if (analyzed.visionVerified) {
    const value = {
      attributes: analyzed.attributes, queries: analyzed.queries,
      visionVerified: true, generatedDescription: analyzed.generatedDescription
    };
    await pool.query(
      'INSERT INTO product_cache(cache_key,value) VALUES($1,$2) ON CONFLICT(cache_key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',
      [key, jsonDbValue(value)]);
  }
  log('product_vision_ready', {
    searchId: job.id, hasReferenceImage: Boolean(analyzed.image),
    visionVerified: analyzed.visionVerified === true, visionIssue: analyzed.visionIssue || null
  });
  return analyzed;
}

export async function processSearch(job) {
  const id = job.id;
  try {
    await stage(id, 'Extracting and analyzing product');
    const product = await prepareProduct(job);
    await updateSearch(id, { product });
    await stage(id, 'Collecting Instagram and Meta in parallel');
    const settled = await Promise.allSettled([
      runSource(id, 'instagram', product), runSource(id, 'meta', product)
    ]);
    const results = [], previews = [], issues = [];
    settled.forEach((outcome, i) => {
      const platform = i === 0 ? 'instagram' : 'meta';
      if (outcome.status === 'fulfilled') {
        results.push(...outcome.value.chosen);
        previews.push(...outcome.value.candidatesPreview);
        issues.push(...outcome.value.issues);
      } else {
        issues.push(`${platform}: ${String(outcome.reason?.message || outcome.reason).slice(0, 240)}`);
        log('source_failed', { platform, searchId: id, error: String(outcome.reason?.message || outcome.reason) });
      }
    });
    await stage(id, 'Saving unique results');
    const client = await pool.connect();
    let kept = [];
    try {
      await client.query('BEGIN');
      for (const video of results) {
        const result = await client.query(
          'INSERT INTO seen_videos(platform,identity,search_id,fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING identity',
          [video.platform, video.identity, id, video.fingerprint]);
        if (result.rowCount) kept.push(video);
      }
      log('saving_search_results', { searchId: id, results: kept.length, previews: previews.length, issues: issues.length });
      await client.query(
        'UPDATE searches SET status=$2,stage=$3,results=$4::jsonb,issues=$5::jsonb,candidate_previews=$6::jsonb,error=NULL,updated_at=now() WHERE id=$1',
        [id, 'completed', 'Completed', jsonDbValue(kept), jsonDbValue(issues), jsonDbValue(previews)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => { });
      log('search_save_failed', {
        searchId: id, code: error.code, message: error.message,
        detail: error.detail, column: error.column
      });
      throw error;
    } finally { client.release(); }
    log('search_completed', {
      searchId: id, verifiedCount: kept.length,
      previewCount: previews.length, issueCount: issues.length
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'search_failed', searchId: id,
      error: String(error?.message || error), code: error?.code, detail: error?.detail,
      stack: error?.stack?.slice(0, 1500)
    }));
    try { await updateSearch(id, { status: 'failed', stage: 'Failed', error: String(error?.message || error) }); }
    catch (saveError) { log('search_failure_update_failed', { searchId: id, error: String(saveError.message || saveError) }); }
  }
}
