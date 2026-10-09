import pg from 'pg';
import {config} from './settings.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? {rejectUnauthorized:true} : false,
  max: 8
});
export async function initDb(){await pool.query(`
CREATE TABLE IF NOT EXISTS searches(id uuid PRIMARY KEY, input text NOT NULL, status text NOT NULL DEFAULT 'queued', stage text NOT NULL DEFAULT 'Queued', product jsonb, error text, results jsonb NOT NULL DEFAULT '[]'::jsonb, issues jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE searches ADD COLUMN IF NOT EXISTS candidate_previews jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS seen_videos(platform text NOT NULL, identity text NOT NULL, search_id uuid NOT NULL REFERENCES searches(id), fingerprint text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(platform,identity));
CREATE INDEX IF NOT EXISTS idx_seen_fingerprint ON seen_videos(platform,fingerprint);
CREATE INDEX IF NOT EXISTS idx_searches_created ON searches(created_at DESC);
CREATE TABLE IF NOT EXISTS product_catalog(source_url text PRIMARY KEY,title text NOT NULL,description text NOT NULL DEFAULT '',brand text NOT NULL DEFAULT '',model text NOT NULL DEFAULT '',image text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS product_cache(cache_key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS vision_score_cache(cache_key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
`)}
const JSON_COLUMNS = new Set(['product', 'results', 'issues', 'candidate_previews']);
const WRITABLE_COLUMNS = new Set(['status','stage','error',...JSON_COLUMNS]);
// JSON.stringify preserves lone UTF-16 surrogates as \uD800-\uDFFF escapes.
// PostgreSQL jsonb rejects those escapes, so repair malformed input first.
export function repairUnicode(value) {
  if (typeof value !== 'string') return value;
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xDC00 && next <= 0xDFFF) {
        out += value[i] + value[++i];
      } else {
        out += '\uFFFD';
      }
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      out += '\uFFFD';
    } else {
      out += value[i];
    }
  }
  return out;
}

export function jsonDbValue(value) {
  // The reviver runs on parsed JSON: nested captions, arrays and explanations
  // are repaired without mutating the original records.
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') throw new Error('Cannot serialize JSON value');
  const repaired = JSON.parse(serialized, (_key, val) => repairUnicode(val));
  return JSON.stringify(repaired);
}

export async function updateSearch(id, fields) {
  const entries = Object.entries(fields);
  if (!entries.length) return;
  for (const [key] of entries) if (!WRITABLE_COLUMNS.has(key)) throw new Error(`Invalid search update field: ${key}`);
  const assignments = entries.map(([key], i) => `"${key}"=$${i+2}${JSON_COLUMNS.has(key) ? '::jsonb' : ''}`);
  const values = entries.map(([key, value]) => JSON_COLUMNS.has(key) ? jsonDbValue(value) : value);
  await pool.query(`UPDATE searches SET ${assignments.join(',')},updated_at=now() WHERE id=$1`, [id,...values]);
}
