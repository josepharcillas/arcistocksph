# Current Task

## Status: Core loop VERIFIED WORKING end-to-end locally (2026-06-14).

> Login → live PSE portfolio → AI signals all work against a local Supabase + free
> live data (phisix + PSE Edge) + Groq. The original Phase-12 blockers are fixed and
> verified. Remaining items are secondary (stock detail page, fundamentals, deploy).

### How to run it locally
1. Local Supabase running (Docker): `npx supabase status` (start with `npx supabase start`)
2. `npm run dev` → http://localhost:4321
3. Log in at `/login` with **demo@arcistocks.local** / **demo123456** (re-seed: `node scripts/seed-user.mjs`)
4. Dashboard shows seeded holdings (SM, BDO, JFC) with live ₱ prices; `/dashboard/signals` generates AI verdicts.

### Verified this session (repeatable scripts in `scripts/`)
- `e2e-db.mjs` — signup trigger, RLS, holdings insert/read ✅
- `e2e-auth.mjs` — login cookie accepted by middleware ✅
- `e2e-signal.mjs` — full protected `/api/analyze` → live data → Groq verdict ✅
- `npm test` — 13 unit tests ✅ · `npm run build` ✅

### Remaining (secondary)
- TASK-068 stock detail page (`/stock/[ticker]` 404s) · TASK-070 fundamentals P/E null
- TASK-067 `ecosystem.config.cjs` for prod deploy · then resume roadmap at TASK-032 (screener)

---

## DO FIRST — Phase 12 blockers (in order)

1. **TASK-064** — `AddHoldingForm` insert omits `user_id` → every "Add Stock" fails (NOT NULL + RLS). XSmall.
2. **TASK-065** — Auth session is stored in localStorage but middleware reads a cookie → logged-in users bounce back to `/login` (login loop). Adopt `@supabase/ssr` or go fully client-rendered. Medium.
3. **TASK-066 + TASK-067** — Production deploy: AI keys aren't passed at build (AI may be off in prod), and `ecosystem.config.cjs` referenced by the deploy workflow doesn't exist (deploy fails). Small.

Then: TASK-068 (build `/stock/[ticker]` — currently 404s from existing links), TASK-070 (fundamentals scraper returns empty), TASK-069 (use the `signal_cache` table), TASK-071 (tests for the finance math).

---

## ACTION REQUIRED — Manual steps by user (still pending)

### TASK-002 — Create Supabase project
1. `supabase.com` → New project → copy `Project URL` + `anon public` key
2. Create `.env` in project root:
   ```
   PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=eyJ...
   GEMINI_API_KEY=your_gemini_key
   ```
3. In Supabase SQL editor, paste and run `docs/schema.sql`

### TASK-003 — Enable Google OAuth in Supabase
1. Supabase → Authentication → Providers → Google → Enable
2. Google Cloud Console → Credentials → OAuth 2.0 Client ID
3. Authorized redirect URI: `https://xxxx.supabase.co/auth/v1/callback`
4. Paste Client ID + Secret into Supabase Google provider settings

---

## Progress Summary (reconciled)

| Phase | Done |
|---|---|
| 0 — Setup | 6/8 (002, 003 pending manual) |
| 1 — AI Provider | 5/5 ✓ |
| 2 — Market Data | 7/8 (018 scraper broken → TASK-070) |
| 3 — Portfolio | 3/6 (024 buggy, 025 partial, 027 missing) |
| 4 — AI Signals | 2/4 (029, 031 partial) |
| 5–11 | pending |
| 12 — Critical Fixes | 0/10 — **DO FIRST** |

---

## After the blockers
Resume the roadmap at **TASK-032 — PSEi 30 seed data + Screener page**:
- `src/data/psei30.ts`, `src/data/pse-stocks.json`
- `src/pages/screener.astro`, `src/components/screener/ScreenerFilters.tsx`, `ScreenerResults.tsx`

---

## How to Resume After Usage Reset
Say **"continue"** — Claude reads CLAUDE.md + CURRENT.md and picks up here.
