import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import * as cheerio from 'cheerio';
import { pool } from './db.js';
import { hash } from './core.js';
import { discoverProduct } from './product-discovery.js';

const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));
const MAX_UPLOAD_BYTES = 4_000_000;
const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp']);

function blockedIp(address) {
  const family = isIP(address);
  if (!family) return true;
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 192 && b === 88 && c === 99);
  }
  const ip = address.toLowerCase();
  if (ip.startsWith('::ffff:') || ip === '::1' || ip === '::') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') ||
      ip.startsWith('fe8') || ip.startsWith('fe9') ||
      ip.startsWith('fea') || ip.startsWith('feb')) return true;
  const first = parseInt(ip.split(':')[0], 16);
  return !(first >= 0x2000 && first <= 0x3fff);
}

async function publicAddresses(hostname) {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => blockedIp(record.address))) {
    throw new Error('URL resolves to unsafe address');
  }
  return records;
}

export async function safeUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('Invalid product or image URL'); }
  if (!['https:', 'http:'].includes(url.protocol) ||
      url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) ||
      !url.hostname || url.hostname === 'localhost' ||
      url.hostname.endsWith('.local')) {
    throw new Error('Unsafe product or image URL');
  }
  await publicAddresses(url.hostname);
  return url;
}

// Connection-level DNS validation prevents a DNS-check/DNS-use race.
// Crucially, Undici/Node can request { all: true } and then expects an
// array of {address, family}, not a bare address string.
const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      publicAddresses(hostname)
        .then(records => {
          if (options?.all) {
            callback(null, records.map(r => ({
              address: r.address,
              family: r.family
            })));
          } else {
            // Respect an explicitly requested family where possible.
            const selected = records.find(r =>
              !options?.family || r.family === options.family
            );
            if (!selected) {
              callback(new Error('No public DNS address for requested family'));
              return;
            }
            callback(null, selected.address, selected.family);
          }
        })
        .catch(error => callback(error));
    }
  }
});

export async function publicFetch(address, {
  maxBytes = 4_000_000,
  timeoutMs = 15000,
  accept = '*/*'
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 6_000_000) {
    throw new Error('Invalid remote download limit');
  }
  let url = await safeUrl(address);
  for (let hops = 0; hops < 5; hops++) {
    const response = await undiciFetch(url.href, {
      dispatcher,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: accept,
        'User-Agent': 'Mozilla/5.0 (compatible; FrameFinder/1.0)'
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect missing location');
      url = await safeUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Remote HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Remote response too large');
    }
    if (!response.body) throw new Error('Remote response empty');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        await response.body.cancel().catch(() => {});
        throw new Error('Remote response too large');
      }
      chunks.push(Buffer.from(chunk));
    }
    return {
      body: Buffer.concat(chunks),
      mime: (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
      url: url.href
    };
  }
  throw new Error('Too many redirects');
}

const absolute = (value, base) => {
  try {
    return value ? new URL(typeof value === 'string' ? value : value?.url || '', base).href : '';
  } catch { return ''; }
};

function imageSignature(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function validateUpload(image) {
  if (typeof image !== 'string') throw new Error('Uploaded image must be a base64 data URI or public HTTPS image URL');
  const value = image.trim();
  if (/^https:\/\//i.test(value)) return value;
  if (/^blob:/i.test(value)) throw new Error('Browser blob URL is not accessible on the server; upload image bytes as a data URI');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) throw new Error('Uploaded image must be JPEG, PNG, or WebP base64 data URI');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error('Uploaded image exceeds 4 MB or is empty');
  const mime = match[1].toLowerCase();
  if (!allowedMime.has(mime) || imageSignature(bytes) !== mime) throw new Error('Uploaded image format does not match its content');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function findProductJsonLd($) {
  const nodes = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value['@type'] === 'Product' ||
        (Array.isArray(value['@type']) && value['@type'].includes('Product'))) {
      nodes.push(value);
    }
    if (value['@graph']) walk(value['@graph']);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try { walk(JSON.parse($(el).html() || 'null')); }
    catch { /* malformed third-party markup */ }
  });
  return nodes[0];
}

async function getCache(cacheKey) {
  const result = await pool.query(
    "SELECT value FROM product_cache WHERE cache_key=$1 AND updated_at > now()-interval '7 days'",
    [cacheKey]
  );
  return result.rows[0]?.value || null;
}

async function catalogUpsert(product) {
  if (!product.sourceUrl || !product.image || !product.title) return;
  await pool.query(`
    INSERT INTO product_catalog(source_url,title,description,brand,model,image)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(source_url) DO UPDATE SET
      title=EXCLUDED.title,description=EXCLUDED.description,
      brand=EXCLUDED.brand,model=EXCLUDED.model,image=EXCLUDED.image,updated_at=now()
  `, [product.sourceUrl, product.title, product.description || '',
    product.brand || '', product.model || '', product.image]);
}

export async function productFrom(input, uploadedImage) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Product keyword or URL is required');
  const isUrl = /^https?:\/\//i.test(raw);
  const cacheKey = 'product:' + hash(raw);
  const verifiedUpload = uploadedImage ? validateUpload(uploadedImage) : '';
  const cached = verifiedUpload ? null : await getCache(cacheKey);
  if (cached?.image && (isUrl || cached.referenceSource === 'auto-discovered')) {
    if (isUrl && cached.sourceUrl && cached.title) await catalogUpsert(cached);
    return { ...cached, cacheHit: true };
  }
  let product = {
    title: raw,
    description: '',
    image: verifiedUpload,
    referenceSource: verifiedUpload ? 'uploaded' : 'keyword',
    url: null,
    sourceUrl: null,
    brand: '',
    model: '',
    attributes: null,
    queries: []
  };
  if (isUrl) {
    try {
      const page = await publicFetch(raw, {
        maxBytes: 5_000_000,
        timeoutMs: 20000,
        accept: 'text/html'
      });
      if (!page.mime.includes('text/html')) throw new Error('Expected an HTML product page');
      const $ = cheerio.load(page.body.toString('utf8'));
      const meta = k => $(`meta[property="${k}"],meta[name="${k}"]`).first().attr('content') || '';
      const structured = findProductJsonLd($);
      const sourceImage = structured?.image;
      const firstImage = Array.isArray(sourceImage) ? sourceImage[0] : sourceImage;
      const brand = structured?.brand;
      product = {
        ...product,
        title: String(structured?.name || meta('og:title') || $('h1').first().text().trim() || $('title').text() || raw).trim(),
        description: String(structured?.description || meta('og:description') || meta('description') || '')
          .replace(/<[^>]*>/g, '').slice(0, 2400),
        image: verifiedUpload || absolute(firstImage, page.url) || absolute(meta('og:image'), page.url) ||
          absolute($('img').first().attr('src'), page.url),
        url: page.url,
        sourceUrl: page.url,
        brand: typeof brand === 'string' ? brand : brand?.name || '',
        model: String(structured?.model || ''),
        sku: String(structured?.sku || ''),
        referenceSource: verifiedUpload ? 'uploaded' : 'product-url'
      };
      await catalogUpsert(product);
    } catch (error) {
      log('product_page_fetch_failed', { reason: String(error?.message || error).slice(0, 200) });
      product.discoveryIssue = 'Product page could not be accessed: ' + String(error?.message || error).slice(0, 160);
    }
  } else if (!verifiedUpload) {
    try {
      const discovery = await discoverProduct(raw, pool);
      const candidates = Array.isArray(discovery?.candidates) ? discovery.candidates : [];
      product.productCandidates = candidates;
      product.discoveryIssue = discovery?.issue || null;
      const selected = discovery?.selected;
      if (selected?.image && selected?.sourceUrl && selected?.title) {
        product = {
          ...product,
          title: selected.title,
          description: selected.description || '',
          image: selected.image,
          url: selected.sourceUrl,
          sourceUrl: selected.sourceUrl,
          brand: selected.brand || '',
          model: selected.model || '',
          sku: selected.sku || '',
          referenceSource: 'auto-discovered',
          referenceConfidence: selected.confidence ?? null
        };
      } else {
        log('product_selection_required', {
          keyword: raw, candidatesFound: candidates.length,
          reason: product.discoveryIssue || 'No unambiguous product reference image'
        });
      }
    } catch (error) {
      product.discoveryIssue = `Catalog discovery unavailable: ${String(error?.message || error).slice(0, 160)}`;
      log('product_discovery_failed', { reason: product.discoveryIssue });
    }
  }
  if (!verifiedUpload && (isUrl || product.image)) {
    await pool.query(
      'INSERT INTO product_cache(cache_key,value) VALUES($1,$2) ON CONFLICT(cache_key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()',
      [cacheKey, JSON.stringify(product)]
    );
  }
  return product;
}
