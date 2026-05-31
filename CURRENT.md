# Current Task

## Status: Phases 0–4 are coded. Manual Supabase setup pending.

---

## ACTION REQUIRED — Manual steps by user (TASK-002 + TASK-003)

Before the app works end-to-end, you must complete these two steps:

### TASK-002 — Create Supabase project
1. Go to `supabase.com` → New project
2. Copy `Project URL` and `anon public` key
3. Create `.env` in the project root:
   ```
   PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=eyJ...
   GEMINI_API_KEY=your_gemini_key
   ```
4. In Supabase SQL editor, paste and run `docs/schema.sql`

### TASK-003 — Enable Google OAuth in Supabase
1. Supabase dashboard → Authentication → Providers → Google → Enable
2. Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID
3. Authorized redirect URI: `https://xxxx.supabase.co/auth/v1/callback`
4. Paste Client ID + Secret into Supabase Google provider settings

---

## Next Coded Task: TASK-032 — PSEi 30 seed data + Screener page

Files to create:
- `src/data/psei30.ts` — 30 PSEi stocks array
- `src/data/pse-stocks.json` — all ~300 PSE stocks
- `src/pages/screener.astro`
- `src/components/screener/ScreenerFilters.tsx`
- `src/components/screener/ScreenerResults.tsx`

---

## Progress Summary

| Phase | Done |
|---|---|
| 0 — Setup | 6/8 (TASK-002, 003 pending manual) |
| 1 — AI Provider | 5/5 ✓ |
| 2 — Market Data | 8/8 ✓ |
| 3 — Portfolio | 6/6 ✓ |
| 4 — AI Signals | 4/4 ✓ |
| 5–11 | pending |

---

## How to Resume After Usage Reset

Say: **"continue"** — Claude reads CLAUDE.md + CURRENT.md and picks up here.
