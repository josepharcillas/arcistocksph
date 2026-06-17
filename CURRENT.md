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
- `npm test` (13 unit) · `npm run build` · `scripts/e2e-{db,auth,signal}.mjs` all green.

### What's DONE
Auth (cookie SSR) · holdings + RLS · live market data · indicators · AI signals
(Groq, DB-cached) · screener + AI picks · stock detail · watchlist + alerts ·
paper trading · leaderboard · fundamentals (mkt cap/shares) · rate limiting ·
disclaimer · SEO · PWA icons + install prompt · error/empty states.

### What's LEFT — needs YOU (cannot be done autonomously)
1. **Production deploy** — create a prod Supabase project, run `docs/schema.sql`,
   set GitHub secrets (`PUBLIC_SUPABASE_*`, `DEPLOY_HOST/USER/SSH_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`), put a `.env` on the server.
   Config is ready (`ecosystem.config.cjs`); CI has been skipped via `[skip ci]`.
2. **Push notifications (TASK-041–044)** — needs a Firebase project + FCM/VAPID keys.

### Deferred (optional)
- TASK-054 shadcn restyle (cosmetic; current styling is consistent).
- TASK-053 leaderboard time filters (needs daily balance snapshots).

### How to resume
Say **"continue"** — but the remaining substantive work needs the manual setup above.
