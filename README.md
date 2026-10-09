# FrameFinder AI — Product Video Discovery & Visual Matching

FrameFinder AI is a full-stack research dashboard for discovering short-form product videos from **Instagram Reels** and the **Meta Ad Library**, then comparing candidate thumbnails with a reference product image using **Google Gemini**.

The application accepts a **product name / keyword** or a **public product-page URL**, with an optional uploaded image. It returns genuine collected candidates, visually evaluated matches where verification is possible, explanations for match scores, and transparent notices when a platform provides too few usable results.

> **Important distinction:** The product aims for **20 Instagram Reels + 20 Meta video ads per search**. These are *targets, not guaranteed counts*. A source may require login, block public access, contain too few videos, or return thumbnails that cannot be verified. FrameFinder AI does not invent source records or claim visually unverified videos are confirmed matches. The vision system compares the **reference photo with a video thumbnail**, not all frames of the video.

## Links

| Resource | URL |
| --- | --- |
| Source code | https://github.com/mukulanand651-gif/framefinder-ai |
| Live React dashboard | https://framefinder-ai-ten.vercel.app |
| Live Express API | https://framefinder-ai.onrender.com |
| API + database health | https://framefinder-ai.onrender.com/api/health |

**Demo hosting arrangement:** Vercel serves the frontend, a Render Web Service serves the API, Neon hosts PostgreSQL, and the **background worker runs on the developer's computer during the demonstration**. The application can be opened at any time, but **new searches require the worker to be online**. The Render Free API can also spin down during inactivity and take time to wake. A separately hosted always-on worker is recommended for unattended evaluation or production.

## 1. Technology stack

| Layer | Implementation |
| --- | --- |
| Dashboard | React 18, Vite, JavaScript, Lucide icons, CSS |
| API | Node.js 20+, Express 4, Zod, CORS, Helmet, Pino HTTP logging |
| Background execution | Separate Node.js worker, PostgreSQL row queue using `FOR UPDATE SKIP LOCKED` |
| Database | Neon PostgreSQL, `pg` connection pool |
| Instagram discovery | Self-hosted Playwright/Chromium public Reel/topic-page collector |
| Meta discovery | Self-hosted Playwright/Chromium Meta Ad Library public-page collector |
| Alternative collectors | Optional Apify and ScrapeCreators integrations, selected through `VIDEO_PROVIDER` |
| Image analysis | Google Gemini API: reference-image attributes and thumbnail comparison |
| Caching | PostgreSQL product cache and vision score cache |
| Hosting | GitHub monorepo → Vercel frontend and Render backend API; local worker for demo |

## 2. Architecture and integration flow

```text
                             ┌────────────────────────────────────┐
                             │ React / Vite dashboard (Vercel)   │
                             │ Search, image upload, history, UI │
                             └──────────────────┬─────────────────┘
                                                │ REST + SSE / polling
                                                ▼
                             ┌────────────────────────────────────┐
                             │ Express API (Render Web Service)  │
                             │ Zod validation, routes, CORS      │
                             └──────────────────┬─────────────────┘
                                                │ INSERT queued search
                                                ▼
                             ┌────────────────────────────────────┐
                             │ Neon PostgreSQL                    │
                             │ Searches, seen videos, caches     │
                             └──────────────────┬─────────────────┘
                                                │ claim queued job
                                                ▼
                             ┌────────────────────────────────────┐
                             │ Node.js background worker         │
                             │ (local PC for current demo)       │
                             └──────────────────┬─────────────────┘
                                                │
                              ┌─────────────────┴──────────────────┐
                              ▼                                    ▼
                    Product context + Gemini             Source-specific collection
                    image attribute analysis             ┌────────────────────────┐
                              │                          │ Instagram Reels        │
                              └────── queries ──────────►│ Meta Ad Library videos │
                                                         └───────────┬────────────┘
                                                                     │
                                                      Normalize, filter, deduplicate
                                                                     │
                                                      Gemini thumbnail comparison
                                                                     │
                                                     Threshold + global seen filter
                                                                     │
                                                      Save results + issues to Neon
                                                                     │
                                                      React receives progress/results
```

**Request lifecycle**

1. A user enters a keyword or product URL, optionally attaching an image.
2. React calls `POST /api/search` with `input` and optional `image` (data URI).
3. Express validates the request, creates a UUID, inserts a `searches` row with `status='queued'`, and immediately returns HTTP **202**.
4. The independent worker polls Neon, claims one queued row transactionally with `FOR UPDATE SKIP LOCKED`, and changes its status to `running`.
5. `product.js` resolves the product title, description, main image and available metadata. For keywords, discovery may use the indexed product catalog; a usable reference image is **not guaranteed**.
6. `vision.js` analyzes the reference image when available: product type, colors, graphics/prints, logos/text and visual details. The pipeline also caches successful analysis.
7. `pipeline.js` generates product-aware search phrases separately for Instagram and Meta. Short phrases, brand/model/category identifiers and grammatical variants help reach different public topics.
8. Instagram and Meta collection run independently, allowing a source failure to be reported without discarding the other source's work. The selected collector is configured by `VIDEO_PROVIDER`.
9. Collected records are normalized, filtered for valid video links, and deduplicated by identity, thumbnail and caption similarity. Confirmed Reel identification can be required.
10. When a reference image and usable candidate thumbnail exist, Gemini compares the two images and returns a **0–100 score plus a reason**. A successfully completed comparison is labeled visually verified at **thumbnail level**.
11. Candidates scoring below `MIN_MATCH_SCORE` (default **60**) are excluded from the verified-match set. If comparison is impossible, records may be placed in a separately labeled **unverified preview** set.
12. Before accepting a verified video, the pipeline checks `seen_videos` to avoid returning videos already shown in earlier searches.
13. Results, previews, stage information and source issues are saved in Neon. The dashboard receives updates through SSE (`/events`) with a polling fallback.

## 3. Repository structure

```text
framefinder-ai/
├── backend/
│   ├── src/
│   │   ├── server.js                # Express API, validation, SSE, history
│   │   ├── worker.js                # PostgreSQL-backed queue consumer
│   │   ├── pipeline.js              # Query generation, scoring, source handling
│   │   ├── query-expansion.js       # Keyword/category variations
│   │   ├── product.js               # Product context extraction, safe URL fetching
│   │   ├── product-discovery.js     # Keyword/catalog product discovery
│   │   ├── vision.js                # Gemini image analysis and thumbnail scoring
│   │   ├── collectors.js            # Source-provider selection and normalization
│   │   ├── selfhosted-scraper.js    # Public Instagram / Meta browser collector
│   │   ├── meta-adapter.js          # Meta ad normalization
│   │   ├── scrapecreators-client.js # Optional third-party connector
│   │   ├── core.js                  # IDs, hashes, near-duplicate logic
│   │   ├── db.js                    # Database schema and persistence utilities
│   │   └── settings.js              # Runtime environment config
│   ├── tests/                       # Automated tests (see actual test files)
│   ├── .env.example
│   ├── Dockerfile
│   ├── package.json
│   └── package-lock.json
├── frontend/
│   ├── src/
│   │   ├── main.jsx                # Dashboard, status, upload, results/history
│   │   └── style.css
│   ├── .env.example
│   ├── vercel.json
│   ├── index.html
│   ├── package.json
│   └── package-lock.json
├── docs/                            # Supporting documentation/evidence templates
├── docker-compose.yml
└── README.md
```

## 4. Local setup

### Prerequisites

- **Node.js 20 or later** and npm; **Node.js 22** is used by the backend Dockerfile.
- A **Neon PostgreSQL database** or a compatible local PostgreSQL installation.
- A valid **Gemini API key** and an available image-capable Gemini model.
- Internet connectivity; **Playwright Chromium** installed locally.
- Git for cloning the repository.

### Clone and configure backend

```bash
git clone https://github.com/mukulanand651-gif/framefinder-ai.git
cd framefinder-ai/backend
npm ci
npx playwright install chromium
```

Copy `backend/.env.example` to `backend/.env` and replace placeholders. On **PowerShell**:

```powershell
Copy-Item .env.example .env
```

Minimum local backend configuration:

```dotenv
PORT=8080
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173
DATABASE_URL=YOUR_NEON_POSTGRESQL_CONNECTION_STRING
DATABASE_SSL=true

VISION_PROVIDER=gemini
GEMINI_API_KEY=YOUR_ROTATED_GEMINI_API_KEY
GEMINI_MODEL=YOUR_TESTED_SUPPORTED_GEMINI_MODEL

VIDEO_PROVIDER=selfhosted
PRODUCT_DISCOVERY_PROVIDER=selfhosted
SELFHOSTED_HEADLESS=true
SELFHOSTED_SCROLLS=4
SELFHOSTED_META_COUNTRY=US

WORKER_POLL_MS=2500
MAX_SOURCE_PASSES=4
APIFY_CANDIDATE_LIMIT=30
MAX_VISION_CHECKS_PER_SOURCE=8
RESULTS_PER_SOURCE=20
MIN_MATCH_SCORE=60
UNVERIFIED_PREVIEW_LIMIT=20
REQUIRE_VISUAL_VERIFICATION=true
REQUIRE_CONFIRMED_REELS=true
DEMO_MODE=false
```

**Notes:** `GEMINI_MODEL` must identify a model actually available to your API key; an example model name is not a guarantee of availability. The `.env.example` is a template only—never put real secrets into it or commit real `.env` files. Use the same Neon connection string for the API and worker. Configure SSL/TLS according to Neon and your runtime's `pg` settings.

Start the **API**, from `backend/`:

```bash
npm start
```

In a **second terminal**, from `backend/`, start the **worker**:

```bash
npm run worker
```

Test API + database connectivity:

```text
http://localhost:8080/api/health
```

Expected on success: `{"ok":true,"mode":"LIVE"}`. This check runs `SELECT 1` against PostgreSQL.

### Configure and start frontend

In a **third terminal**:

```bash
cd frontend
npm ci
```

Create `frontend/.env` with:

```dotenv
VITE_API_URL=http://localhost:8080
```

Then:

```bash
npm run dev
```

Open **http://localhost:5173**.

> The frontend **reads `VITE_API_URL`**, not `VITE_API_BASE_URL`. All `VITE_` values are exposed in the browser bundle. Never put database credentials or Gemini API keys in frontend environment variables.

## 5. API contract

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Test Express + PostgreSQL; returns `ok` and `mode` |
| `POST` | `/api/search` | Validate input, queue a search, return HTTP 202 + search ID |
| `GET` | `/api/search/:id` | Retrieve status, product, results, previews and issues |
| `GET` | `/api/search/:id/events` | SSE progress stream; frontend falls back to polling |
| `GET` | `/api/history` | Latest 30 searches with summary data |
| `GET` | `/api/previous` | Most recent completed searches used for the previously-seen UI |

Example:

```bash
curl -X POST http://localhost:8080/api/search \
  -H 'Content-Type: application/json' \
  -d '{"input":"oversized graphic tee"}'
```

Typical response:

```json
{"id":"<uuid>","status":"queued"}
```

To search a product page, pass its public URL as `input`. To include an image, provide a supported image data URI in `image` (the frontend limits uploads to **2 MB**).

### Input handling and security

- Zod validates input lengths and optional image payloads in Express.
- The backend's product fetcher is designed to reject unsafe/internal destinations and validate redirects and image content; the API entry route itself performs only basic URL parsing, so URL security depends on the downstream fetcher.
- Keep `DATABASE_URL`, `GEMINI_API_KEY`, and optional provider credentials server-side.
- CORS is restricted by `FRONTEND_ORIGIN` (comma-separated origins supported). A browser origin must match **exactly**, without a trailing slash.
- API authentication, per-user isolation and server-side request quotas are **not provided as production-grade protections**; add them before making this an unrestricted public service.

## 6. Video collection

### Instagram Reels

Default provider: `VIDEO_PROVIDER=selfhosted`. Playwright opens publicly reachable Instagram topic/tag surfaces, follows accessible public paths, extracts Reel links, visible text and thumbnails, then normalizes records. The pipeline can reject records without evidence they are Reels when `REQUIRE_CONFIRMED_REELS=true`.

Public Instagram access is inconsistent. Some terms redirect to `/accounts/login/`; others expose Reel links. For example, during local diagnostic testing, the topic **“toys for kids”** returned publicly discoverable Reel candidates while related phrases such as **“kid toy”** were login-restricted. This is **diagnostic sourcing evidence**, not proof that those videos match one exact toy.

The backend records `source_query_failed` and continues to the next distinct expanded query when a public topic requires login. It does not bypass authentication, CAPTCHA or rate limits.

### Meta Ad Library

The default Playwright collector searches public Meta Ad Library pages for keyword-related video ads. Where publicly accessible, it extracts video/ad records, links, ad copy and thumbnails; `meta-adapter.js` normalizes candidate fields. Availability, media labeling, ad card association and regional coverage may vary.

### Alternative provider options

`backend/src/collectors.js` can switch between:

```dotenv
VIDEO_PROVIDER=selfhosted
# or
VIDEO_PROVIDER=apify
# or
VIDEO_PROVIDER=scrapecreators
```

`apify` requires an Apify token, compatible actor IDs and matching input templates; `scrapecreators` requires its API key and provider-specific support. These are **optional integrations**, not required for the described self-hosted demo. Provider compatibility and access must be verified separately.

### Insufficient results and source failures

- `MAX_SOURCE_PASSES` controls how many generated queries are attempted; the current pipeline caps this at **five**.
- Duplicate and non-Reel filtering can reduce usable candidates.
- `MAX_VISION_CHECKS_PER_SOURCE` limits fresh Gemini comparisons per source (default example: **8**), which can make reaching 20 verified matches impossible even if 20+ candidates were collected.
- Failures are logged per query/source and shown as issues or shortfalls; the pipeline does not fabricate missing videos.
- A valid 40-video **collection** is not equivalent to **40 visually verified exact-product matches**.

## 7. Image-analysis brain and scoring

**Reference analysis:** `vision.js` sends a valid product image to Gemini to extract descriptive visual features (product type, colors, design, text/logos, material/shape where inferable). The pipeline uses this context, title, brand/model and grammatical topic expansions to construct source-specific searches.

**Candidate verification:** For each eligible candidate with an accessible thumbnail, Gemini receives two images: (1) the reference product photo and (2) the video thumbnail. It returns a numeric score **0–100** and a textual reason. Strong evidence includes matching print, logo, colorway, form and distinctive design; a generic category resemblance should score lower.

**Decision rules:**

- A comparison successfully returned by Gemini can be marked `verified: true`, with `evidenceType: "thumbnail"` and `fullVideoVerified: false`.
- `MIN_MATCH_SCORE=60` is the default acceptance threshold.
- Below-threshold candidates are excluded from verified results.
- Missing reference photos, broken candidate thumbnails, Gemini errors and exhausted vision budgets yield **unverified candidates** rather than fabricated accepted matches.
- Verification applies to the **thumbnail only**. Frame sampling across the whole video is a planned improvement.

**Caching:** product analysis and thumbnail scores use PostgreSQL cache tables with expiry checks; cache hits reduce repeat Gemini calls. Cache entries include model/reference/candidate characteristics so unrelated comparisons are not reused indiscriminately.

## 8. Uniqueness and near-duplicate handling

Video records are normalized to a platform plus an ID-derived identity (SHA-256). Within each search, the pipeline removes repeated identities and checks other candidates for near-duplicates using:

- The same platform/video identity.
- Identical normalized thumbnail URLs (ignoring query parameters).
- High caption token-set similarity (Jaccard threshold **0.87**, with a minimum caption length requirement).

For cross-search uniqueness, accepted videos are checked against the PostgreSQL `seen_videos` table by identity or a fingerprint derived from platform, normalized caption tokens and thumbnail URL. The pipeline stores newly accepted results and lets the dashboard deliberately display previous completed-search results through **Show previously seen**.

**Limitations:** caption/thumbnail fingerprints are approximations, not perceptual hashes of media bytes or video embeddings. Reuploads with changed covers or descriptions can bypass near-duplicate detection. The seen-history policy is installation-wide rather than account-specific.

## 9. Database tables

`backend/src/db.js` creates the required tables on API/worker startup with `initDb()`:

| Table | Purpose |
| --- | --- |
| `searches` | Search input, status/stage, product, results, unverified previews, source issues, timestamps |
| `seen_videos` | Cross-search platform identities and fingerprints |
| `product_catalog` | Previously indexed product source URL, title, description and main image |
| `product_cache` | Cached product analysis |
| `vision_score_cache` | Cached product-image / candidate-thumbnail comparisons |

The queue uses database rows rather than a separate Redis service. The worker locks and claims pending rows transactionally using `FOR UPDATE SKIP LOCKED`, allowing the API to respond immediately while searches run asynchronously.

## 10. Deployed integration — GitHub, Vercel, Render and Neon

The source is a **single GitHub repository** with separate `frontend/` and `backend/` directories. A push to `main` supplies the source for both hosting services.

### Frontend — Vercel

1. Import the GitHub repository in Vercel.
2. Set **Root Directory** to `frontend`, **Framework** to **Vite**.
3. Set **Install** `npm ci`, **Build** `npm run build`, **Output** `dist`.
4. Add `VITE_API_URL=https://framefinder-ai.onrender.com` in Vercel **Environment Variables**. It is a public frontend configuration value, not a secret.
5. **Redeploy** after changing Vite environment variables; they are incorporated at build time.
6. The existing `frontend/vercel.json` supplies an SPA navigation rewrite to `/index.html`. React currently calls the absolute Render API URL through `VITE_API_URL`, so an additional `/api` proxy rewrite is **not required** for this configuration.

### Express API — Render Web Service

1. Connect the same GitHub repository in Render.
2. Set **Root Directory** to `backend` and runtime to **Docker** (uses `backend/Dockerfile`).
3. Run Express with the Dockerfile's `npm start` command.
4. Supply `DATABASE_URL`, `DATABASE_SSL=true`, Gemini variables and collector settings in Render **Environment**.
5. Set `FRONTEND_ORIGIN=https://framefinder-ai-ten.vercel.app` (**no trailing slash**). The backend's `cors()` uses this allowlist. Multiple origins may be comma-separated.
6. Set health check path to `/api/health` and verify it returns `{"ok":true,"mode":"LIVE"}`.

**Production browser troubleshooting:** If health works by opening the Render URL directly but the Vercel dashboard reports “Backend offline,” inspect DevTools Console/Network for a CORS error. Confirm the exact Vercel origin is listed in `FRONTEND_ORIGIN`, the service has redeployed, and the Vercel frontend has the **correct `VITE_API_URL`** variable (not `VITE_API_BASE_URL`).

### Background worker — current demo mode of hosting

A separate continuously running `npm run worker` process is required. The current low-cost demo arrangement runs it **on the developer's own machine**, not on Render Free:

```powershell
cd C:\framefinder-ai-deploy\backend
npm ci
npm run worker
```

Use a private `backend/.env` pointing to **the same Neon database** as the Render API. The worker can process jobs submitted from the live Vercel site because both processes access the same Neon `searches` table. **Keep the machine online, terminal open and PC awake for the entire demo.** If this worker is offline, newly submitted searches will remain queued.

For unattended client testing, deploy the worker as a separate always-on service (for example, a paid Render Background Worker) with the same GitHub repository, backend Dockerfile, `npm run worker` command and database/Gemini configuration. The present free Render Web Service alone is not a reliable 24/7 Playwright-worker host.

## 11. Running the live demonstration

1. Confirm https://framefinder-ai.onrender.com/api/health returns `{"ok":true,"mode":"LIVE"}`.
2. Start the worker locally in the configured backend directory.
3. Open https://framefinder-ai-ten.vercel.app and verify the **Backend offline** warning does not appear.
4. Enter a product name; optionally upload its reference photo so Gemini can visually verify results.
5. Enter a public product URL and inspect extracted product title/main image.
6. Observe progress, source issues, thumbnail evidence, scores and match explanations.
7. Repeat an earlier search; inspect new results and use the previously-seen toggle to access older results intentionally.
8. Confirm actual source counts in the UI and worker logs. Do not treat candidate count as verified-match count.

## 12. Logs, error handling and troubleshooting

| Symptom | Likely cause / action |
| --- | --- |
| `Cannot GET /health` | Health route is **`/api/health`**, not `/health`. |
| Render `/api/health` returns `503` | Neon connectivity / credentials / TLS problem. Check Render logs and `DATABASE_URL`. |
| Dashboard says `Backend offline` | Confirm Vercel `VITE_API_URL`, redeploy, inspect CORS and Render service availability. |
| Browser reports missing `Access-Control-Allow-Origin` | Correct Render `FRONTEND_ORIGIN` to exact Vercel origin without trailing slash. |
| Search stays `queued` | Start the separate worker; verify both API and worker use the same Neon database. |
| `instagram: public page requires login or is blocked` | Public topic inaccessible. Try generated alternative queries; do not assume anonymous access is guaranteed. |
| Meta candidates collected but no verified matches | Examine candidate thumbnails, image fetching, Gemini errors, score threshold and vision check budget. |
| `vision_score_error` | Investigate thumbnail download, image MIME, Gemini quota/model or request timeout. |
| Fewer than 20 results | Show actual verified counts and source issues. Query expansion and collector coverage cannot guarantee the minimum. |
| Container cannot launch Chromium | Ensure Playwright browsers and system dependencies are installed by the backend Docker build. |
| `npm run worker` fails with `ENOENT package.json` | Execute it from the `backend/` directory, not the repository root. |

The backend logs structured JSON events including `server_started`, `worker_started`, `product_reference_resolved`, `product_vision_ready`, `dynamic_source_queries`, `source_query_failed`, `selfhosted_batch`, `candidate_scored`, `source_filter_summary` and `search_completed`.

## 13. Tests and evidence

The current `backend/package.json` provides `npm test` with a `tests/*.test.js` glob, while a previously shared repository snapshot included a `.test.mjs` test file. Check the actual `backend/tests/` filenames and correct the npm script if necessary before claiming that the automated suite passes. A direct test run for an `.mjs` test can use:

```bash
cd backend
node --test tests/discovery.test.mjs
```

> **Evidence status:** The repository contains test infrastructure and the pipeline has been exercised with local diagnostic queries, but **a complete five-product benchmark with reproducible per-source collected/verified counts is not included in this README**. No 20+20 result is claimed without an actual completed run. The assignment's separate test-evidence deliverable should be populated using real outputs and screenshots from at least five products.

Recommended evidence fields:

| Product | Input | Instagram collected | Instagram verified | Meta collected | Meta verified | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Oversized graphic tee | Keyword / image | TBD | TBD | TBD | TBD | Record a successful match and a rejection |
| Nike Air Force 1 | Keyword / image | TBD | TBD | TBD | TBD | Distinguish identical colorways from other models |
| Protein dark chocolate | Keyword / product URL | TBD | TBD | TBD | TBD | Check packaging differences |
| Musical duck toy | Keyword / product URL | TBD | TBD | TBD | TBD | Note blocked public Instagram topics |
| Fifth distinct product | Keyword / product URL | TBD | TBD | TBD | TBD | Include repeat-search deduplication |

Do not replace `TBD` with inferred or demo-mode numbers. Use actual searches, video links, screenshots and worker logs; record the date and relevant query/provider settings.

## 14. Known limitations and future work

1. **Coverage:** Public Instagram and Meta pages can block automation, change markup, restrict regions, expire assets or offer fewer than 20 usable source records.
2. **Exact visual matching:** Gemini currently evaluates thumbnails only. A thumbnail match does not establish that the complete video shows the exact product.
3. **Verification capacity:** Per-source Gemini checks are capped (`MAX_VISION_CHECKS_PER_SOURCE`), creating a trade-off between cost/latency and total accepted results.
4. **Keywords without imagery:** Brand/category text is insufficient to establish an exact visual match; upload an image or provide a working product URL.
5. **Uniqueness:** Fingerprint/caption matching is useful but not equivalent to video-level perceptual similarity.
6. **Recovery:** A worker crash after claiming a job may require recovery/reset logic; leases and job retries should be added for stronger resilience.
7. **Demo availability:** The demo's local worker must be running; Render Free can spin down. Always-on deployment needs a dedicated worker service.
8. **Security and tenancy:** Add login/authentication, tenant-specific seen history, request rate limits, provider spend controls and monitoring before exposing the service broadly.
9. **Planned improvements:** Frame sampling, perceptual hashes/embeddings, broader legitimate source access, adaptive pagination, confidence calibration, queue leases, automated integration tests, dashboards for provider health and optional TikTok support.

## 15. Credential and deployment safety

- Store real credentials only in local ignored `.env` files or hosting provider secret configuration.
- Never commit `.env`, API keys or Neon passwords; `.env.example` must contain placeholders only.
- Rotate credentials previously exposed through screenshots or Git history.
- Do not put secrets under a `VITE_` prefix; values prefixed with `VITE_` are included in the browser build.
- Respect Instagram/Meta terms and publicly accessible data restrictions. This project does not implement login or CAPTCHA bypass.

---

**Project status:** GitHub-hosted full-stack prototype with a live Vercel frontend, live Render API, Neon persistence and an externally run worker for the current client demo. Actual video availability and visually verified counts depend on source accessibility and successful Gemini thumbnail comparison. This README describes the implementation and integration flow without treating collection targets or simulated data as verified outcomes.
