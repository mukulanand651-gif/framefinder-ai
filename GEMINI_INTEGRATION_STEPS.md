# FrameFinder: Gemini + Instagram + Meta setup

## Replace files safely
This project is based on the prior FrameFinder ZIP. Back up your current folder. Replace `backend/src/vision.js`, `backend/src/collectors.js`, `backend/src/pipeline.js`, `backend/.env.example` from this project; retain your **private** `backend/.env`, any local modifications you want to preserve, and your existing Neon database. If you do not have `backend/src/meta-adapter.js`, copy it too. This release does not include secrets.

## Local quick start (Windows PowerShell)
1. Create a key in Google AI Studio (see https://aistudio.google.com/api-keys). Verify your account's free-tier quota/region/model access.
2. In `backend/.env`, keep your existing `DATABASE_URL`, `DATABASE_SSL`, `APIFY_TOKEN`, and actor IDs. Add `GEMINI_API_KEY=<your private key>`, `GEMINI_MODEL=gemini-2.5-flash-lite`, `DEMO_MODE=false`, `MIN_MATCH_SCORE=60`, and `REQUIRE_VISUAL_VERIFICATION=true`. Follow the included `.env.example` for actor templates.
3. From `backend/`: `npm install`, `npm test`, `npm start` (terminal one).
4. From `backend/`: `npm run worker` (terminal two).
5. From `frontend/`: create `.env` with `VITE_API_URL=http://localhost:8080`, then `npm install` and `npm run dev` (terminal three).
6. Search a specific product and **upload its reference photo**, or use a product URL with extractable image. Inspect worker JSON events `provider_batch`, `source_pass`, `source_filter_summary`.

## How it works
- `vision.js`: calls Gemini `generateContent` REST API using reference image (data:image/jpeg/png/webp or remotely fetched HTTPS) and thumbnail. No OpenAI dependency. Detects colors, graphics, shape, visible wording; compares *thumbnails*, not complete video frames. Failed vision checks return `verified:false` and are excluded from final results by default.
- `collectors.js`: calls configured Apify actors, normalizes Instagram data and `creative.media[]` Meta video ads, logs raw vs normalized counts; retries only transient HTTP errors. The actor can fail due to blocked/limited popular results. Apify may charge for runs.
- `pipeline.js`: runs Instagram and Meta independently/parallel, processes up to 5 query rounds, avoids repeated IDs, near-duplicates and history; only accepts candidates with score >= threshold, and when enabled requires successful visual verification. Shows shortfalls rather than inventing videos.

## Constraints / accuracy
- NO GUARANTEE OF 20+20 matches: genuine inventory, provider permissions, rate limits, deduplication and visual quality determine counts.
- Instagram `type: Video` is not sufficient proof of a Reel. `REQUIRE_CONFIRMED_REELS=true` accepts only those marked by a `/reel/` permalink in this starter; many valid actor video posts have `/p/` URLs and remain unconfirmed. Keep platform Reels target separate from generic videos until you can validate source media classification.
- Meta `creative.media[]` parsing matches the selected actor's documented output shape. Verify the actual output on your account: these adapters were not live-tested with your credentials.
- Free Gemini tier is rate-limited, model/region-dependent, and not guaranteed. Hundreds of candidates can exhaust it; cache and prefilter for production.
- Caching thumbnail scores currently uses a per-process memory map only, not persistent distributed cache.
- The worker is a continuous process: do **not** deploy it to Vercel Functions unchanged. Use React on Vercel, Express API + worker on a persistent worker host, Neon DB, Google Gemini API, Apify.
- Meta and Instagram scraping must comply with platform terms and data permissions.

## Deploy
- GitHub: frontend and backend can be pushed separately; ensure `.env` is ignored. Configure Render web service: `npm start`, and separate background worker: `npm run worker` (worker may require a paid host). Configure the same database/provider environment variables on both services.
- Vercel: deploy `frontend/` as Vite, environment `VITE_API_URL=https://<public backend>`, output `dist`.
- Backend: configure `FRONTEND_ORIGIN=https://<your vercel frontend>` and redeploy. Keys go in backend/worker env settings only, never in `VITE_` variables.

## Diagnostic fields
- `provider_batch`: raw Apify item count, normalized item count (nonvideo Meta entries dropped here).
- `source_filter_summary`: normalized candidates, repeated IDs, near-duplicates, historical IDs, unverified vision checks, below-threshold count, accepted count, passes, shortfall.

## Safety for production
The starter does not have authentication, API request quotas, strong crash recovery, or robust defenses against DNS rebinding for fetched image URLs. Add these before allowing unrestricted public use. Do not show sample videos as real results. Set `DEMO_MODE=false` for real demonstrations.
