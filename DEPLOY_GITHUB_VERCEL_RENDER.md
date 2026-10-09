# FrameFinder AI — GitHub → Vercel + Render + Neon deployment

## Accurate status
The React application is designed for Vercel, while Express and the perpetual PostgreSQL queue worker run as separate services on Render. A Vercel deployment alone will **not run the worker**. The Meta adapter in this edition normalizes documented `coregent/facebook-ads-library-scraper` `creative.media` and `creative.cards[].media` video records, but real Meta coverage **cannot be tested without your Apify account**. No result count is fabricated.

## 0. Local requirements
Node.js 20+, Git, GitHub, Neon account, Vercel account, Render account, Apify account, and a functioning accessible image-capable vision model. Prepare the existing backend `.env` locally. To run locally use three PowerShell terminals: `cd C:\product-video-brain\backend; npm install; npm start`, another `cd C:\product-video-brain\backend; npm run worker`, and `cd C:\product-video-brain\frontend; npm install; npm run dev`.

## 1. Verify Meta actor in Apify **before** deployment
Open https://apify.com/coregent/facebook-ads-library-scraper and press Try for free. Input JSON (start small to conserve credits):

```json
{"searchTerms":["oversized graphic tee"],"countries":["US"],"adStatus":"active","mediaTypes":["video"],"maxResults":20}
```

Run actor. Inspect Output JSON, preferably the `creatives` dataset view. Confirm **each** accepted item has `adArchiveId`, `adLibraryUrl`, and `creative.media` with a `{ "type": "video", "url": "...", "thumbnailUrl": "..." }` item. Image-only ads are purposely rejected; a successful actor run with zero usable videos will not be counted. The actor is community maintained; pricing, schema and availability can change. If actor input differs, use the successful run input JSON and document changes. With this actor, the normalizer `backend/src/meta-adapter.js` is the critical integration. A summary or count-only dataset must not be treated as actual video ads.

## 2. Backend environment (local, Render API, Render worker)
Create `backend/.env` from `backend/.env.deploy.example` locally; never commit `.env`. On Render use the Environment dashboard, not the `.env` file. Set **on both** API and worker:

```
DATABASE_URL=<YOUR NEON POSTGRESQL CONNECTION STRING>
DATABASE_SSL=true
DEMO_MODE=false
APIFY_TOKEN=<YOUR TOKEN>
INSTAGRAM_ACTOR_ID=apify~instagram-search-scraper
INSTAGRAM_ACTOR_INPUT={"search":"{{QUERY}}","searchType":"popular","searchLimit":60}
META_ACTOR_ID=coregent~facebook-ads-library-scraper
META_ACTOR_INPUT={"searchTerms":["{{QUERY}}"],"countries":["US"],"adStatus":"active","mediaTypes":["video"],"maxResults":60}
MIN_MATCH_SCORE=60
WORKER_POLL_MS=2500
```

**Vision:** The stock `backend/src/vision.js` requires `OPENAI_API_KEY` on the **worker** for visual verification. If using the previously supplied Ollama patch, it requires a reachable `OLLAMA_URL` **from the Render worker** and matching `VISION_PROVIDER=ollama`, `OLLAMA_MODEL=gemma3:4b`. `localhost:11434` on Render is *not* your laptop. Hosting model inference remotely usually costs money and requires private access controls; the free local model does not automatically make hosted inference free. Without accessible vision, product matches are unverified; do not present them as exact visual matches.

Set `FRONTEND_ORIGIN=https://YOUR-VERCEL-PROJECT.vercel.app` on API (can temporarily be `http://localhost:5173` while testing local). `PORT=8080` is valid locally; Render sets its own `PORT` automatically.

## 3. Test the backend before Git
From the backend folder: `npm install`, `npm test`, `node --check src/collectors.js`. Test live `npm start` plus `npm run worker`; make one search with actual product image. `/api/health` returns status and mode; it does not test provider coverage. `/api/search` accepts the job, `/api/search/:id` returns results and issues, `/api/history` lists prior jobs. The live source can fail/return fewer than 20, which the UI explicitly flags.

## 4. Push **two** GitHub repositories
1. On GitHub create an empty repository named `framefinder-frontend` and an empty one named `framefinder-backend` (do not initialize READMEs).
2. In `C:\product-video-brain\frontend` run:

```
git init
git add .
git commit -m "React dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USER/framefinder-frontend.git
git push -u origin main
```

3. In `C:\product-video-brain\backend` run analogous commands using the `framefinder-backend` remote. Confirm `git status --ignored` reports `.env` and `node_modules` ignored. Never commit a token, DB password or Apify output containing private data.

## 5. Render API
Render → New → Web Service → connect `framefinder-backend` → Node → build `npm install` → start `npm start` → health path `/api/health`. Set backend env variables in Render, especially `DATABASE_URL`, `DATABASE_SSL`, `FRONTEND_ORIGIN`, `DEMO_MODE=false`, and Apify settings. Choose a plan that supports always-on use; inspect Render's current pricing. Wait for deployed `https://YOUR-API.onrender.com/api/health` to report `{ "ok": true, "mode": "LIVE" }`.

## 6. Render worker
Render → New → Background Worker → same `framefinder-backend` repo → build `npm install` → start `npm run worker`. **Copy the identical database and provider env variables to this service**. Worker needs the vision endpoint/key as well. The worker has no public URL. Logs should show `{ "event": "worker_started" }`. If you skip this step, searches stay queued forever. If Render does not offer a worker on your plan, use another always-on Node worker host; Vercel alone is not an equivalent replacement.

## 7. Vercel frontend
Vercel → Add New → Project → import `framefinder-frontend`. Framework: Vite. Root: `./`. Build: `npm run build`. Output: `dist`. Set `VITE_API_URL=https://YOUR-API.onrender.com` in Vercel Project Settings → Environment Variables for Production. Deploy. Open live URL. Return to Render API service, set `FRONTEND_ORIGIN` to **the exact Vercel origin** and redeploy. If you change VITE_API_URL later, redeploy Vercel. A preview deployment has a different origin and may require adding that origin to `FRONTEND_ORIGIN`.

## 8. Smoke test
1. Vercel URL loads UI, no demo banner.
2. `https://YOUR-API.onrender.com/api/health` returns LIVE.
3. Input product keyword with uploaded image; API responds 202; worker logs stage updates.
4. Click actual Instagram card and confirm authentic Reel classification. Some Instagram `/p/` videos aren't confirmed Reels.
5. Click Meta video ad card and confirm its Ads Library archive ID and video creative.
6. Verify product image attributes and reasons are **vision-verified**, not fallback estimates.
7. Repeat search and check no previously delivered identities recur; toggle previously seen to review history.
8. Track actual Instagram and Meta accepted counts and explicit shortfalls. There is **no guaranteed 20+20 per arbitrary product**, especially under free-tier limits.

## 9. Known limitations to fix for public production
This is a working starter, **not an independently verified production-ready service**. Complete SSRF protection including DNS resolution and redirects on product URLs, rate limiting and auth on public API, worker crash recovery/leases, media frame extraction, robust Instagram Reel classification, source-specific pagination, stronger visual near-duplicate matching, secure persisted image upload rather than large base64 rows, and per-source diagnostics. Current shared `stage` updates can race when both collectors run in parallel; stage text is informative, not a reliable exact progress percent. The current Apify synchronous endpoint may fail for long actor runs, and retries may incur usage. Verify pricing and platform policies before scraping. Recorded `Completed` means the job ended, *not* that 20/20 was achieved.
