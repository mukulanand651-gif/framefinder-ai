# FrameFinder AI — Product Video Intelligence

A full-stack React, Express, PostgreSQL and AI-assisted product video research pipeline. **Read this before presenting:** the included demo mode synthesizes records; it does not fetch or validate real social videos. Live provider mode is an integration framework and **has not been independently end-to-end validated against your chosen Apify actors**. Never claim the synthetic counts as sourcing evidence.

## What the app does

- Product keyword or product URL input; optional uploaded photo (up to 2 MB).
- Server extracts title, description, Open Graph and JSON-LD product details from public HTML.
- Image model extracts product type, colors, prints, logos, words, shape and inferred material. Missing images or failed vision calls are visibly flagged.
- AI-generated queries are passed to both Instagram and Meta collectors in parallel.
- Scores up to five 60-item collection batches per source; thumbnail-vs-product-image visual comparison on live mode; rejects scores below 60.
- Stores globally seen platform identity and content fingerprints in PostgreSQL, rejects similar captions and identical thumbnail URLs inside each search; allows displaying old results.
- Queues jobs in PostgreSQL via `FOR UPDATE SKIP LOCKED`, REST poll/SSE progress, per-provider issue reporting and history.
- **No fabricated fallbacks** in LIVE mode: if a source lacks 20 verified matches, results report the shortfall.

## Critical implementation limitations

1. **Not validated end-to-end in live mode.** Exact Apify Actor IDs, input schemas, output schemas, login requirements, coverage and fees differ. Check the chosen actor documentation and configure the JSON input and normalization in `backend/src/collectors.js`.
2. **Demo mode is entirely simulated.** Fake records link to example.com; synthetic scores explicitly say simulated; it is only for frontend/queue demonstration, not assignment proof.
3. Image checking currently examines candidate thumbnail, **not video frames**. A thumbnail may not represent the entire video; this is weaker than exact product verification and must be disclosed.
4. Names without a product photo rely on a limited non-visual estimate. For accurate image-first work, supply a photo or a working product URL. In live mode the matcher rejects low textual scores, often resulting in zero matches.
5. Basic deduplication uses ID, normalized caption similarity and exact thumbnail URL. It does **not** implement perceptual hashing or clip embeddings; changed uploads can slip through.
6. Product URL validation blocks obvious local/private DNS ranges and manual redirect hops, but production SSRF protection additionally requires DNS pinning / egress firewall, limiting redirects, public CDN image proxy validation, and upload/storage scanning.
7. Remote video thumbnails may not allow CORS, may expire or be blank; API-provided thumbnail URL must be public and accessible by the vision vendor.
8. There is no user authentication, tenant isolation, request-level rate limiting, or spend quota. Protect API with authentication and budgets before public launch.
9. If the long worker crashes while a job is `running`, that job currently needs an administrative manual reset to `queued`. Implement leases/recovery for robust production use.
10. Per-video vision requests make 20+20 expensive and can take minutes. Add batching, concurrency control and embedding-based prefilters before scale.
11. Previous-seen comparison is global across all searches in one installation (single-user assignment); a multi-user app should scope `seen_videos` by account.
12. Vercel hosts the static React frontend; always-on worker and API should be hosted on Render, Railway or equivalent. This is deliberate, not an all-Vercel deployment.

## Folders

```
frontend/                # standalone React/Vite project for GitHub + Vercel
backend/                 # standalone Express API + worker for GitHub + Render
  src/server.js          # REST API, input validation, SSE
  src/worker.js          # Postgres queue consumer
  src/pipeline.js        # fanout, scoring, deduplication, persistence
  src/product.js         # product URL extraction + URL safety checks
  src/vision.js          # OpenAI image analysis and scoring
  src/collectors.js      # Apify integration / explicitly labeled demo source
  src/core.js            # video normalization / deduplication / scoring fallback
  src/db.js              # PostgreSQL table creation
  tests/core.test.js     # lightweight core tests
docs/                     # submission materials and evaluation templates
```

## Step 1 — Prerequisites

Install Node.js 20+, Git and (for local DB) PostgreSQL 16 or Docker Desktop. Create free/paid accounts for GitHub, Vercel, Neon and Render. Obtain an OpenAI API key and an Apify API token if using live mode. Expect third-party fees.

## Step 2 — Database on Neon

1. Visit https://neon.tech and create a project, e.g. `framefinder`.
2. Open Neon project's **Connect** dialog and copy the PostgreSQL connection string. It should look like `postgresql://USER:PASSWORD@HOST/DB?sslmode=require`.
3. Do not paste credentials into your frontend or commit them. Database tables are created automatically by backend `initDb()` on service start.
4. Configure `DATABASE_SSL=true` for Neon if the provider/driver requires a TLS connection, and use a current CA-trusted endpoint. Local Docker uses `DATABASE_SSL=false`. Some Neon URLs already carry SSL params; verify your driver connection against its current docs.

## Step 3 — Backend locally

```bash
cd backend
cp .env.example .env
npm install
npm test
npm start
```

Update `.env` first with actual `DATABASE_URL`. In a second terminal:

```bash
cd backend
npm run worker
```

Check `http://localhost:8080/api/health`. The API and worker are **two separate Node processes**. The API creates queue rows; the worker claims and processes them.

## Step 4 — Frontend locally

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. Search `oversized graphic tee` in DEMO mode to check the UI and flow. The synthetic items and numeric match scores are not verification evidence.

## Step 5 — Enable live sources

Set `DEMO_MODE=false`, `OPENAI_API_KEY`, `APIFY_TOKEN`, `INSTAGRAM_ACTOR_ID`, `META_ACTOR_ID`, `INSTAGRAM_ACTOR_INPUT` and `META_ACTOR_INPUT` in **backend only**.

Use current actor docs from https://apify.com/store. Suggested starting points: Apify Instagram content scraper and a Meta Ad Library scraper. Check whether the chosen actor supports **keyword or hashtag discovery** (some actors only accept a profile or URL), commercial Meta ads, video-only filtering and paginated results. The default template fields in `.env.example` are **illustrative, not guaranteed actor schemas**.

Actor IDs often use `owner~actor-name`; configure exact published actor IDs. Input templates support placeholders `{{QUERY}}`, `{{LIMIT}}`, `{{OFFSET}}`. A backend example: `INSTAGRAM_ACTOR_INPUT={"search":"{{QUERY}}","resultsLimit":60}`. Change the keys to match the actual Actor API. `collectors.js` recognizes common URL/image/text fields, but actors returning different shapes must be adapted.

For real matching, provide public image URLs: pasted Shopify/brand product URLs with Open Graph images typically work; some Amazon listings block automated access. User-uploaded base64 photos work only if the vision provider accepts data URLs and payload fits request limits.

**Provider behavior:** 3 attempts with exponential backoff; 125s timeout; per-source error isolation; five retrieval rounds; alternate image-inspired queries and pagination offset; reports shortfalls. No login bypass or CAPTCHA circumvention is provided. Meta official Ad Library API commercial coverage has significant regional/API limits; verify lawful access and platform conditions. Third-party scraper access may be unstable or incompatible with terms.

## Step 6 — Separate Git repositories

The ZIP is a monorepo-style handoff with **separate root projects**. Create two empty GitHub repositories (`framefinder-frontend`, `framefinder-backend`). Do not commit the containing folder as the repo root if you want separate repos.

```bash
cd frontend
git init
git add .
git commit -m "feat: AI discovery frontend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/framefinder-frontend.git
git push -u origin main

cd ../backend
git init
git add .
git commit -m "feat: API and video job processor"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/framefinder-backend.git
git push -u origin main
```

Build a truthful commit history with subsequent real improvements and tests; do not fake commits or backdate work.

## Step 7 — Deploy backend to Render

1. Render → **New Web Service** → GitHub `framefinder-backend`.
2. Runtime Node, build `npm install`, start `npm start`. Health check `/api/health`.
3. Set backend environment variables from `backend/.env.example`. Use Neon `DATABASE_URL`; `PORT` may be provided by Render. Set `FRONTEND_ORIGIN=https://YOUR_FRONTEND.vercel.app`.
4. Deploy and verify `https://YOUR_API.onrender.com/api/health` shows `{ok:true,mode:"LIVE"}` or DEMO.
5. Render → **New Background Worker** with **same backend repo**; build `npm install`, start `npm run worker`; **same `DATABASE_URL`, OpenAI, Apify and source configuration**. Workers may require a paid plan. If unavailable, run the worker on Railway or a small VM instead. A sleeping free web instance is not a substitute for a persistent queue consumer.
6. Restart worker if you modify any of its variables. Confirm both services have started successfully.

## Step 8 — Deploy frontend to Vercel

1. Vercel → Add New Project → Import `framefinder-frontend` GitHub repo.
2. Framework preset **Vite**, root directory `./`, build command `npm run build`, output `dist`.
3. Add `VITE_API_URL=https://YOUR_API.onrender.com` **without a trailing slash**.
4. Deploy. Copy the deployed Vercel URL, add it to Render `FRONTEND_ORIGIN`, then redeploy backend.
5. Reload the Vercel app. Validate API health and open browser dev tools → Network to confirm the POST `/api/search` returns HTTP 202 and subsequent GET/SSE reaches completion.
6. Every update to `VITE_API_URL` requires redeployment because Vite embeds it at build time.

## Step 9 — End-to-end client checks

- Product keyword + optional reference photo: verify attributes / search progress / results.
- Product URL with accessible Open Graph image: verify title, description, image and queries.
- Run with actual Apify actor access and check real Instagram reel / Meta ad URLs, video-only status, source-specific count and score reasons.
- Repeat identical search: new results should appear if fresh provider inventory exists, otherwise **honest 0/20 counts**.
- Toggle previously seen, inspect search history and score sorting.
- Test source unavailable, bad URL, no image, quota exhausted, source underfill, slow query, database error.
- Run `npm test` before pushing backend.

## APIs

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | DB liveness + demo/live marker |
| POST | `/api/search` | Body `{ "input": "product or URL", "image": "optional data URI" }` → 202 with search ID |
| GET | `/api/search/:id` | Search status, product, videos, provider issues |
| GET | `/api/search/:id/events` | SSE stage snapshots, every 1.5s |
| GET | `/api/history` | Recent history |
| GET | `/api/previous` | Previous completed result sets |

## Deduplication algorithm

1. Normalize platform + platform ID (fallback permalink) to SHA-256 identity.
2. Fingerprint platform, normalized first 12 caption terms and thumbnail URL without query params.
3. Filter against global `seen_videos` table by identity or fingerprint.
4. Within the current search, reject identical identity, identical thumbnail URLs, or near-identical captions with Jaccard >= 0.87 (only captions >45 characters).
5. Score candidate visual correspondence; keep only >=60; acquire more candidates from alternate queries / deeper offset, at most 5 rounds.
6. Insert kept results into a unique Postgres index transactionally. If concurrent jobs claim the same ID only one inserts it.
7. History stays queryable through a toggle; returning old results never changes whether they count as novel results.

**Trade-off:** caption-level similarity can over-deduplicate templated ads or under-deduplicate different captions for the same clip. Upgrade to perceptual frame hashes + image embeddings and advertiser creative IDs for robust near-duplicates.

## Why the image brain works this way

Reference photo → vision-language attribute extraction → platform search terms → provider records → dual-image model comparison (product photo and video thumbnail) → 0–100 explained score. Compared to fixed image embeddings, a multimodal vision model provides interpretability and can compare prints, logos and graphics in natural language. **It is not guaranteed accurate**; testing needs hand-labeled examples. The `fallbackScore` is a keyword-only bounded estimate and always marked `verified:false`.

## Security checklist before real public deployment

Add authenticated users, per-user isolation, rate limits, outgoing request firewall, pinned-IP URL fetch, thumbnail/media proxy restrictions, worker recovery leases, provider quota limits, retry-jitter, CSP, monitored error reporting, cost ceilings, privacy policy and retention policy. Never treat this starter as security-audited production software.

## Delivery / grading honesty

A fully rendered **dashboard demo** is possible with synthetic records; the **40 real videos and exact-product verification requirements are not automatically fulfilled** by this ZIP. Reviewers should evaluate live video count only after real actor configuration and hand-audited sources. There are no invented five-product performance numbers. Fill in `docs/TEST_EVIDENCE.md` with actual production runs. Capture a 3–5 minute video using `docs/DEMO_SCRIPT.md` only after verifying claims.

## Next improvements

Frame extraction, embeddings + perceptual hashes, real keyword discovery connectors with audited schemas, multi-user authentication, reliable leasing/job recovery, resilient API quotas, human match review, downloadable shortlists, TikTok toggle and true provider-level pagination.
