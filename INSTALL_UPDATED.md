# FrameFinder integration update

## What changed
- `backend/src/pipeline.js`: source-specific, distinct fallback queries; PostgreSQL cache for successful visual scores; independent sources; verified and preview records saved atomically.
- `backend/src/db.js`: adds `vision_score_cache` automatically when API initializes.
- `backend/src/vision.js`: shorter thumbnail fetch timeout; existing Gemini quota handling.
- `frontend/src/main.jsx`: shows collected unverified candidates in the feed whenever verified matches are absent; never counts candidates as verified.
- `backend/.env.example`: safe placeholder configuration.

## Install on Windows
1. Back up your current `C:\product-video-brain` directory. Extract this ZIP to a new location.
2. Copy your **rotated** secrets into `backend/.env` locally, never into GitHub.
3. In `backend`, run `npm install`, `npm test`, then `npm start`.
4. In a second `backend` terminal, run `npm run worker`.
5. In `frontend`, run `npm install`, `npm run build`, then `npm run dev`.
6. Test `http://localhost:8080/api/health` and `http://localhost:5173`.
7. Submit a new product search with reference image; in the worker logs look for `provider_batch` and `source_filter_summary`.

## Deploy
- Deploy frontend to Vercel: Vite root `frontend` (or separate repository), build `npm run build`, output `dist`; set `VITE_API_URL` to public Node API URL.
- Deploy backend to a persistent Node.js web host with `npm start` and a background worker host with `npm run worker`. Both must have the same `DATABASE_URL`; only the worker needs Gemini/Apify credentials.
- Apply `FRONTEND_ORIGIN` for exact Vercel domain; enable authentication, rate limits, monitoring, and worker process recovery before public access.
- Neon database initialization occurs through `initDb()` on API start.

## Honest acceptance criteria
- Instagram scraping may be blocked and its actor may return video posts rather than confirmed Reels.
- Meta video candidates may not show the exact reference product.
- Free Gemini API quota and thumbnail availability constrain visual checks; it is not possible to guarantee 20 new verified matches per platform for arbitrary products.
- Only visually verified scores count as matches. Unverified source candidates are labeled separately.
- Existing near-duplicate detection uses caption/thumbnail URL; perceptual hashes of video frames remain future work.
- Test five products and fill README with observed counts and URLs; never invent evidence.
