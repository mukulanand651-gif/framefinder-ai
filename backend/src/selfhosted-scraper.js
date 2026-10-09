import { chromium } from 'playwright';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clamp = (value, fallback, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : fallback;
};
const clean = value => Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0, 240).join('');
const BLOCK_TEXT = /log in to continue|login to continue|sign up to see|captcha|unusual activity|temporarily blocked|automated requests|confirm your identity/i;

function httpUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function reelFromRaw(item) {
  const link = httpUrl(item?.url);
  const match = link.match(/^https?:\/\/(?:www\.)?instagram\.com\/reel\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i);
  if (!match) return null;
  const id = match[1];
  return {
    platform: 'instagram', id, identity: `instagram:reel:${id}`,
    url: `https://www.instagram.com/reel/${id}/`, caption: clean(item.caption),
    thumbnail: httpUrl(item.thumbnail), postedAt: null, videoUrl: null,
    isConfirmedReel: true, mediaType: 'video'
  };
}
function metaFromRaw(item) {
  const id = String(item?.id ?? '');
  if (!/^\d{6,25}$/.test(id) || item?.hasVideo !== true) return null;
  return {
    platform: 'meta', id, identity: `meta:${id}`,
    url: `https://www.facebook.com/ads/library/?id=${id}`,
    caption: clean(item.caption), thumbnail: httpUrl(item.thumbnail),
    videoUrl: httpUrl(item.videoUrl) || null, postedAt: null, mediaType: 'video'
  };
}
export function normalizePublicItems(platform, items) {
  if (!['instagram', 'meta'].includes(platform)) throw new Error('Unsupported platform');
  if (!Array.isArray(items)) return [];
  const unique = new Map();
  for (const item of items) {
    const normalized = platform === 'instagram' ? reelFromRaw(item) : metaFromRaw(item);
    if (normalized && !unique.has(normalized.identity)) unique.set(normalized.identity, normalized);
  }
  return [...unique.values()];
}
function accessError(platform, reason) {
  const error = new Error(`${platform}: ${reason}`);
  error.code = 'PUBLIC_ACCESS_UNAVAILABLE';
  return error;
}
async function inspectPage(page, platform) {
  const url = page.url();
  const body = await page.locator('body').innerText({ timeout: 6000 }).catch(() => '');
  const title = await page.title().catch(() => '');
  const redirected = /instagram\.com\/(?:accounts\/login|challenge)\/|facebook\.com\/login(?:\/|\?|$)/i.test(url);
  const blocked = redirected || BLOCK_TEXT.test(body.slice(0, 2500));
  const dom = await page.evaluate(() => ({
    reelLinks: document.querySelectorAll('a[href*="/reel/"]').length,
    adLinks: document.querySelectorAll('a[href*="ads/library/"]').length,
    videos: document.querySelectorAll('video').length,
    images: document.querySelectorAll('img').length
  })).catch(() => ({}));
  console.log(JSON.stringify({ event: 'selfhosted_page', platform, url, title: title.slice(0, 120), blocked, bodyLength: body.length, ...dom }));
  if (blocked) throw accessError(platform, 'public page requires login or is blocked');
  return { bodyLength: body.length, ...dom };
}
function instagramTags(query) {
  const terms = clean(query).toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!terms.length) return [];
  // The public tag page is NOT a global Reel search endpoint.
  const tags = [terms.join(''), terms.slice(0, 3).join(''), terms.slice(0, 2).join('')];
  return [...new Set(tags.filter(tag => tag.length >= 3).map(tag => tag.slice(0, 45)))];
}
async function instagramSearch(page, query, scrolls) {
  const tags = instagramTags(query);
  const results = new Map();
  const errors = [];
  for (const tag of tags) {
    try {
      await page.goto(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(1100);
      await inspectPage(page, 'instagram');
      for (let i = 0; i <= scrolls; i++) {
        const items = await page.locator('a[href*="/reel/"]').evaluateAll(links => links.map(anchor => {
          const img = anchor.querySelector('img') || anchor.parentElement?.querySelector('img');
          return { url: anchor.href, thumbnail: img?.currentSrc || img?.src || '', caption: img?.alt || anchor.getAttribute('aria-label') || '' };
        })).catch(() => []);
        for (const item of items) if (item.url) results.set(item.url, item);
        if (i < scrolls) { await page.mouse.wheel(0, 950); await sleep(700); }
      }
    } catch (error) {
      errors.push({ tag, reason: String(error.message || error).slice(0, 140) });
      console.warn(JSON.stringify({ event: 'selfhosted_query_failed', platform: 'instagram', tag, reason: errors.at(-1).reason }));
      // A login restriction cannot be fixed by more requests to the same session.
      if (error.code === 'PUBLIC_ACCESS_UNAVAILABLE') break;
    }
    if (results.size >= 100) break;
  }
  if (!results.size && errors.some(e => /requires login or is blocked/.test(e.reason))) {
    throw accessError('instagram', 'public page requires login or is blocked');
  }
  return [...results.values()];
}

async function visibleMetaCards(page) {
  return page.evaluate(() => {
    const found = new Map();
    const roots = [...document.querySelectorAll('a[href*="ads/library/"], div, span')];
    for (const node of roots) {
      if (node.children.length > 8) continue;
      let id = '';
      const text = (node.innerText || '').trim();
      const match = text.length < 180 ? text.match(/Library ID\s*:?\s*(\d{6,25})/i) : null;
      if (match) id = match[1];
      if (!id && node instanceof HTMLAnchorElement) {
        try { id = new URL(node.href).searchParams.get('id') || ''; } catch {}
      }
      if (!/^\d{6,25}$/.test(id)) continue;
      let ancestor = node;
      for (let depth = 0; depth < 8 && ancestor; depth++, ancestor = ancestor.parentElement) {
        const content = ancestor.innerText || '';
        if (content.length > 6500) break;
        const video = ancestor.querySelector('video');
        const play = ancestor.querySelector('[aria-label*="Play video" i], [data-testid*="play-video"]');
        if (!video && !play) continue;
        // Avoid assigning one massive containing element to many unrelated ads.
        if (ancestor.querySelectorAll('video').length > 4) break;
        const image = ancestor.querySelector('img');
        const thumbnail = video?.poster || image?.currentSrc || image?.src || '';
        found.set(id, { id, hasVideo: true, thumbnail, videoUrl: video?.currentSrc || video?.src || '', caption: content.slice(0, 500) });
        break;
      }
    }
    return [...found.values()];
  });
}
async function metaSearch(page, query, scrolls) {
  const url = new URL('https://www.facebook.com/ads/library/');
  url.searchParams.set('active_status', 'all');
  url.searchParams.set('ad_type', 'all');
  url.searchParams.set('country', process.env.SELFHOSTED_META_COUNTRY || 'US');
  url.searchParams.set('media_type', 'video');
  url.searchParams.set('q', clean(query));
  url.searchParams.set('search_type', 'keyword_unordered');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1200);
  const initial = await inspectPage(page, 'meta');
  const found = new Map();
  for (let i = 0; i <= scrolls; i++) {
    // Wait briefly for dynamically rendered creatives; navigation links alone aren't ads.
    await page.locator('video, [aria-label*="Play video" i]')
      .first().waitFor({ state: 'attached', timeout: 2500 }).catch(() => {});
    const batch = await visibleMetaCards(page).catch(() => []);
    for (const item of batch) found.set(item.id, item);
    if (i < scrolls) { await page.mouse.wheel(0, 1100); await sleep(850); }
  }
  console.log(JSON.stringify({ event: 'meta_extraction_diagnostic', initialBodyLength: initial.bodyLength, videoElements: await page.locator('video').count().catch(() => 0), extractedVideoAds: found.size }));
  return [...found.values()];
}
export async function collectSelfHosted(platform, query, offset = 0, limit = 30) {
  if (!['instagram', 'meta'].includes(platform)) throw new Error('Unknown platform');
  if (!clean(query)) throw new Error('Search query required');
  if (offset !== 0) throw new Error('Self-hosted collector cannot paginate reliably');
  const browser = await chromium.launch({ headless: process.env.SELFHOSTED_HEADLESS !== 'false' });
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, locale: 'en-US' });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const scrolls = clamp(process.env.SELFHOSTED_SCROLLS, 4, 8);
      const raw = platform === 'instagram' ? await instagramSearch(page, query, scrolls) : await metaSearch(page, query, scrolls);
      const results = normalizePublicItems(platform, raw).slice(0, clamp(limit, 30, 100));
      console.log(JSON.stringify({ event: 'selfhosted_batch', platform, query: clean(query), rawCount: raw.length, normalizedCount: results.length, withThumbnails: results.filter(x => x.thumbnail).length }));
      return results;
    } finally { await context.close().catch(() => {}); }
  } finally { await browser.close().catch(() => {}); }
}
