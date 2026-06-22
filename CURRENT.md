# Current Task

## Status: MVP feature-complete and verified locally (2026-06-17).

Phases 0–11 substantially done. Every sidebar route works end-to-end against a
local Supabase + free live data (phisix + PSE Edge) + Groq AI.

### Run it locally
1. Local Supabase (Docker): `npx supabase start` (status: `npx supabase status`)
2. `npm run dev` → http://localhost:4321
3. Log in at `/login`: **demo@arcistocks.local** / **demo123456** (re-seed: `node scripts/seed-user.mjs`)
4. Explore: Portfolio, Signals, Screener (+ AI-rank), Stock detail, Watchlist, Paper Trading, Leaderboard.

### Verified (repeatable)
- `npm test` (15 unit) · `npm run build` · `scripts/e2e-{db,auth,signal}.mjs` all green.
- `npm run test:ui` (Playwright smoke, CI-safe) · `scripts/smoke-tickers.mjs` (5 live PSE
  tickers through the authed HTTP path: data + AI signal) · `scripts/check-notifications.mjs`.
- Indicator math corrected (Wilder RSI, full-series MACD signal, SMA averages available data).
- Push send path verified locally with VAPID keys (`/api/push/notify` runs; delivery needs a real browser).

### What's DONE
Auth (cookie SSR) · holdings + RLS · live market data · indicators · AI signals
(Groq, DB-cached) · screener + AI picks · stock detail · watchlist + alerts ·
paper trading · leaderboard · fundamentals (mkt cap/shares) · rate limiting ·
disclaimer · SEO · PWA icons + install prompt · error/empty states.

### What's LEFT — needs YOU (cannot be done autonomously)
1. **Production deploy** — step-by-step guide in **`docs/DEPLOY.md`** (Vultr +
   hosted Supabase): create a prod Supabase project, run `docs/schema.sql`,
   set GitHub secrets (`PUBLIC_SUPABASE_*`, `DEPLOY_HOST/USER/SSH_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`), put a `.env` on the server.
   Config is ready (`ecosystem.config.cjs`); CI has been skipped via `[skip ci]`.
2. **Push notifications** — code is DONE (TASK-042/043/044: client subscribe,
   `web-push` server send + `/api/push/notify`, SW handlers, settings page,
   `push_preferences` table). Only TASK-041 remains: generate VAPID keys
   (`npx web-push generate-vapid-keys`) and set `PUBLIC_FCM_VAPID_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_NOTIFY_SECRET` in `.env`. Run the
   new `push_preferences` table from `docs/schema.sql` on prod Supabase.

### Deferred (optional)
- TASK-054 shadcn restyle (cosmetic; current styling is consistent).
- TASK-053 leaderboard time filters (needs daily balance snapshots).

### How to resume
Say **"continue"** — but the remaining substantive work needs the manual setup above.
