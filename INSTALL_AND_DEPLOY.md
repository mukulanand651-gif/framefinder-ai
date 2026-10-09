# FrameFinder AI — corrected discovery + verification build

## Important behavior
- React displays **verified matches** in the existing Instagram and Meta tabs, and real **unverified source candidates** in a separate section. Candidates do not count toward 20+20.
- A missing reference image, failed thumbnail, exhausted Gemini quota, or slow AI **does not prevent Apify discovery**.
- This build intentionally uses one source query and two Gemini comparisons per source by default for a responsive demo. It cannot achieve 20 verified matches/source with those settings.
- This code does NOT guarantee 20 matching Reels or 20 matching Meta video ads for arbitrary products. Source coverage and genuine visual similarity determine the result. Meta output schema and Instagram Reel classification must be checked against live provider data.
- A source candidate is not a confirmed Reel without a trustworthy media classification. Set `REQUIRE_CONFIRMED_REELS=true` after confirming the actor supplies suitable Reel evidence; otherwise label generic Instagram videos accurately.

## Install locally on Windows
1. Back up `C:\product-video-brain` and keep its original `backend/.env` file. Do not copy any keys into Git.
2. Replace the `backend/src` folder using this ZIP. Replace `frontend/src/main.jsx` too; the new UI renders unverified candidates separately. Preserve package.json files.
3. If you have exposed Neon/Gemini/Apify credentials in chat, rotate them before continuing. Paste new values only into backend/.env.
4. Set the backend environment as below, plus your existing Neon and Apify secrets.
5. Terminal A: `cd C:\product-video-brain\backend && npm install && npm test && npm start`
6. Terminal B: `cd C:\product-video-brain\backend && npm run worker`
7. Terminal C: `cd C:\product-video-brain\frontend && npm install && npm run dev`
8. Open `http://localhost:5173`, search a product (preferably with a reference image), and watch progress.

## Backend .env settings
```
PORT=8080
DATABASE_URL=YOUR_ROTATED_NEON_URL
DATABASE_SSL=true
FRONTEND_ORIGIN=http://localhost:5173
DEMO_MODE=false
GEMINI_API_KEY=YOUR_ROTATED_GEMINI_KEY
GEMINI_MODEL=gemini-3.5-flash-lite
APIFY_TOKEN=YOUR_ROTATED_APIFY_TOKEN
INSTAGRAM_ACTOR_ID=apify~instagram-search-scraper
INSTAGRAM_ACTOR_INPUT={"search":"{{QUERY}}","searchType":"popular","searchLimit":30}
META_ACTOR_ID=coregent~facebook-ads-library-scraper
META_ACTOR_INPUT={"searchTerms":["{{QUERY}}"],"countries":["US"],"adStatus":"active","mediaTypes":["video"],"maxResults":30}
MIN_MATCH_SCORE=60
REQUIRE_VISUAL_VERIFICATION=true
REQUIRE_CONFIRMED_REELS=false
MAX_SOURCE_PASSES=1
APIFY_CANDIDATE_LIMIT=30
MAX_VISION_CHECKS_PER_SOURCE=2
RESULTS_PER_SOURCE=20
UNVERIFIED_PREVIEW_LIMIT=12
GEMINI_MIN_INTERVAL_MS=7000
```
The two Apify JSON templates are examples: use actor Input JSON schemas you actually tested; pricing/availability are actor-specific.

## Database upgrade
No manual migration: `initDb()` adds `candidate_previews` with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` when the API or worker starts. `candidate_previews` does not enter `seen_videos` and does not count as verified matches.

## Search API
- `POST /api/search` takes `{ "input": "oversized graphic tee", "image": "data:image/jpeg;base64,..." }` and returns a queued search ID.
- `GET /api/search/:id` includes `results` (verified matches), `candidate_previews` (unverified, separate), and `issues`.
- `GET /api/history` is light and does not include image blobs.
- `GET /api/search/:id/events` streams progress states.

## When AI is unavailable
Apify still collects candidates and the UI shows a clearly labeled preview. A preview is not a validated product match; it is not placed in `seen_videos`. Genuine 20+20 acceptance still requires image-based verification, valid media types, and unique source material.

## Scale-up after the demo
- Increase `MAX_VISION_CHECKS_PER_SOURCE` and `MAX_SOURCE_PASSES` only when your provider's Gemini requests/day and requests/minute allow it.
- Introduce persistent score caching keyed by product-image hash and normalized video identity. Current Gemini cache is only process-local.
- Expand genuinely different queries or pagination supported by the selected actor. Do not rerun the same keywords/offset and count duplicates.
- Sample authorized video frames rather than relying solely on thumbnails, and calibrate against five labeled products.
- Add API authentication, per-user quotas, production rate limiting, durable worker recovery, and enhanced SSRF protections before unrestricted public access.

## GitHub + Vercel + backend host
- Frontend repository (`frontend/` contents) -> Vercel Vite app. Set `VITE_API_URL=https://YOUR-BACKEND-HOST` (redeploy after changing).
- Backend repository (`backend/` contents) -> Node Web Service: build `npm install`, start `npm start`, health `/api/health`.
- Same backend repo -> persistent Node Worker: start `npm run worker`. Use the same Neon URL and Gemini/Apify credentials.
- Backend environment `FRONTEND_ORIGIN=https://YOUR-VERCEL-URL`.
- A persistent worker generally needs a non-Vercel process host; a Vercel Function cannot run this existing endless worker loop. Hosting and Apify actors may cost money.
- Check frontend, API, worker and database connectivity first, then verify a genuine Instagram and Meta run individually. Free quotas do not guarantee 20+20.

## Testing summary
Backend unit tests and static parse checks run locally in the development container. Provider calls and live frontend rendering still require your own credentials and deployment. No real 20+20 result is claimed.
