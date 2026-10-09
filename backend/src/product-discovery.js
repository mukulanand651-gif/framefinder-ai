// First-party keyword discovery from product pages previously analyzed by this app.
// No SerpApi, storefront allowlist or speculative external search.
const tidy = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stopWords = new Set(['the','with','and','for','buy','shop','online','product','men','mens','women','womens']);
const tokens = value => [...new Set(tidy(value).split(' ').filter(x => x.length > 1 && !stopWords.has(x)))];

export function rankProducts(keyword, items) {
  const needed = tokens(keyword);
  if (!needed.length) return [];
  return items.map(item => {
    const haystack = new Set(tokens(`${item.title || ''} ${item.brand || ''} ${item.model || ''} ${item.variant || ''}`));
    const found = needed.filter(token => haystack.has(token)).length;
    const coverage = found / needed.length;
    const exact = tidy(item.title) === tidy(keyword);
    return {...item, confidence: Number(Math.min(1, coverage * 0.92 + (exact ? 0.08 : 0)).toFixed(3))};
  }).filter(item => item.image && item.sourceUrl && item.confidence >= 0.55)
    .sort((a,b) => b.confidence-a.confidence || a.title.length-b.title.length);
}

export async function discoverProduct(keyword, db) {
  // Search the application's own indexed products; no external discovery fees.
  const result = await db.query(
    `SELECT title, description, brand, model, image, source_url AS "sourceUrl"
     FROM product_catalog ORDER BY updated_at DESC LIMIT 1000`
  );
  const ranked = rankProducts(keyword, result.rows).slice(0, 8);
  const best = ranked[0];
  const runner = ranked[1];
  // Do not guess a reference for ambiguous brand/model/colorway searches.
  const certain = tokens(keyword).length >= 3 && best?.confidence >= 0.99 &&
    (!runner || best.confidence - runner.confidence >= 0.20);
  return {
    selected: certain ? best : null,
    candidates: ranked,
    issue: certain ? null : ranked.length
      ? 'Select the exact product variant to verify videos.'
      : 'No matching product in the local catalog yet. Paste its product URL once to index it, or upload a reference image. Video discovery can continue without verification.'
  };
}
