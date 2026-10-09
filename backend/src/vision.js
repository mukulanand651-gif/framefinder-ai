import { fallbackScore, hash } from './core.js';
import { publicFetch } from './product.js';

const key = () => process.env.GEMINI_API_KEY;
const model = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const results = new Map();
let nextCall = 0;
let queue = Promise.resolve();
let unavailableUntil = 0;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errorText = error => String(error?.message || error).slice(0, 240);
const MAX_IMAGE_BYTES = 4_000_000;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function detectMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function imageBytesPart(bytes, claimedMime) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw Error(`Image must contain 1 to ${MAX_IMAGE_BYTES} bytes`);
  }
  const actualMime = detectMime(bytes);
  if (!actualMime || !MIME_TYPES.has(actualMime)) throw Error('Unsupported image bytes: expected JPEG, PNG, or WebP');
  if (claimedMime && claimedMime !== actualMime) throw Error(`Image MIME mismatch: ${claimedMime} vs ${actualMime}`);
  return { inline_data: { mime_type: actualMime, data: bytes.toString('base64') } };
}

export async function imagePart(input) {
  if (typeof input !== 'string' || !input.trim()) throw Error('Image missing');
  const value = input.trim();

  // Uploaded images should use a data URI and must NOT be sent to publicFetch.
  const dataUri = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(value);
  if (dataUri) {
    const mime = dataUri[1].toLowerCase();
    if (!MIME_TYPES.has(mime)) throw Error(`Unsupported uploaded image MIME: ${mime}`);
    const base64 = dataUri[2].replace(/\s/g, '');
    if (!base64 || base64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
      throw Error('Invalid or oversized uploaded base64 image');
    }
    return imageBytesPart(Buffer.from(base64, 'base64'), mime);
  }

  if (value.startsWith('data:')) throw Error('Unsupported data URI: expected base64 JPEG, PNG, or WebP');
  if (value.startsWith('blob:')) throw Error('Browser blob URL cannot be read by backend; upload image bytes instead');
  if (!/^https:\/\//i.test(value)) throw Error('Image must be an uploaded data URI or public HTTPS URL');

  // publicFetch must retain its SSRF protections (public DNS/IP, redirect validation, limits).
  const { body, mime } = await publicFetch(value, {
    maxBytes: MAX_IMAGE_BYTES, timeoutMs: 20000, accept: 'image/*'
  });
  const headerMime = String(mime || '').split(';')[0].trim().toLowerCase();
  return imageBytesPart(body, MIME_TYPES.has(headerMime) ? headerMime : undefined);
}

function schedule(task) {
  const pending = queue.then(async () => {
    if (Date.now() < unavailableUntil) throw Error('Gemini temporarily unavailable; wait before retrying');
    const wait = Math.max(0, nextCall - Date.now());
    if (wait) await delay(wait);
    nextCall = Date.now() + Math.max(6500, Number(process.env.GEMINI_MIN_INTERVAL_MS || 7000));
    return task();
  });
  queue = pending.catch(() => {});
  return pending;
}

async function generate(prompt, images, tokens = 350) {
  if (!key()) throw Error('GEMINI_API_KEY not configured');
  if (Date.now() < unavailableUntil) throw Error('Gemini temporarily unavailable; wait before retrying');

  // Convert before the rate-limited API call; allow individual-image diagnostics.
  const imageParts = [];
  for (let i = 0; i < images.length; i++) {
    try {
      imageParts.push(await imagePart(images[i]));
    } catch (error) {
      throw Error(`Image ${i + 1} preparation failed: ${errorText(error)}`);
    }
  }

  return schedule(async () => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model())}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': key(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: tokens, temperature: 0.1 }
      }),
      signal: AbortSignal.timeout(Math.min(90000, Math.max(15000, Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 60000))))
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 250);
      if (response.status === 429) unavailableUntil = Date.now() + 90_000;
      if ([401, 403].includes(response.status)) unavailableUntil = Date.now() + 10 * 60_000;
      throw Error(`Gemini HTTP ${response.status}: ${detail}`);
    }
    const data = await response.json();
    const content = (data.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('');
    if (!content) throw Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason || 'unknown reason'})`);
    try {
      return JSON.parse(content);
    } catch {
      throw Error(`Gemini returned invalid JSON (${data.candidates?.[0]?.finishReason || 'unknown finish reason'})`);
    }
  });
}

export function visionAvailable() {
  return Boolean(key()) && Date.now() >= unavailableUntil;
}

const unknown = () => ({
  productType: 'unknown', colors: [], graphics: [], logos: [],
  material: 'unknown', shape: 'unknown', text: []
});

function stringList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 12) : [];
}

export async function analyze(product) {
  if (!product.image) return {
    ...product, attributes: unknown(), queries: [product.title],
    visionVerified: false, visionIssue: 'No product image supplied'
  };
  try {
    const out = await generate(
      `Identify only visibly supported product attributes for ${JSON.stringify(product.title)}. Return JSON with keys: productType:string, colors:string[], graphics:string[], logos:string[], material:string, shape:string, text:string[], queries:string[]. Queries should be 3 useful product-specific search phrases; avoid guessing unseen details.`,
      [product.image], 650
    );
    const attributes = {
      ...unknown(), ...out,
      colors: stringList(out.colors), graphics: stringList(out.graphics),
      logos: stringList(out.logos), text: stringList(out.text)
    };
    // Avoid a provider response overwriting internal status with arbitrary fields.
    const generatedDescription = [attributes.productType, ...attributes.colors, ...attributes.graphics, ...attributes.logos, ...attributes.text].filter(Boolean).join(', ');
    const queries = [...new Set([product.title, ...stringList(out.queries)])].slice(0, 6);
    return { ...product, attributes, generatedDescription, queries, visionVerified: true, visionIssue: null };
  } catch (error) {
    console.warn(JSON.stringify({ event: 'vision_analysis_error', error: errorText(error) }));
    return { ...product, attributes: unknown(), queries: [product.title], visionVerified: false, visionIssue: errorText(error) };
  }
}

export async function score(product, video) {
  if (!product.image || !video.thumbnail || !visionAvailable()) return {
    ...fallbackScore(product, video), verified: false,
    reason: 'No accessible visual verification; text-only estimate.'
  };
  const cacheKey = hash(`${model()}|${hash(product.image)}|${video.platform}|${video.identity}|${video.thumbnail}`);
  if (results.has(cacheKey)) return results.get(cacheKey);
  try {
    const out = await generate(
      `Compare FIRST image REFERENCE PRODUCT with SECOND image VIDEO THUMBNAIL. Do not infer unseen video frames. Product: ${product.title}. Candidate caption: ${String(video.caption || '').slice(0, 450)}. Return JSON {"score":integer 0..100,"reason":string}. For high scores, require the same distinctive product design, logos, colorways, and shape. Treat different models/products as low scores, even if the category matches. Use 0..59 for weak or uncertain matches.`,
      [product.image, video.thumbnail], 300
    );
    const numeric = Number(out.score);
    const valid = out.score !== null && out.score !== undefined && Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
    const result = {
      score: valid ? Math.round(numeric) : null,
      reason: String(out.reason || 'No reason supplied').slice(0, 280),
      verified: valid, evidenceType: 'thumbnail', fullVideoVerified: false
    };
    results.set(cacheKey, result);
    if (results.size > 500) results.delete(results.keys().next().value);
    return result;
  } catch (error) {
    console.warn(JSON.stringify({ event: 'vision_score_error', platform: video.platform, error: errorText(error) }));
    return {
      ...fallbackScore(product, video), verified: false,
      reason: `Visual verification unavailable: ${errorText(error)}`
    };
  }
}
