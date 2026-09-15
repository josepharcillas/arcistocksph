# ArciStocks PH — AI Project Context

## What This Is
A Progressive Web App (PWA) for Filipino investors. It provides AI-powered buy/sell/hold signals for PSE-listed stocks, portfolio tracking, paper trading, a leaderboard, and push notifications. Built on top of the arcitools ecosystem.

## Stack
- **Framework:** Astro 5 + React 19 + TypeScript (strict)
- **Styling:** Tailwind CSS 4 — dark theme (slate-950 base, green/red accents)
- **Auth + DB:** Supabase — Google OAuth, Postgres
- **Market Data:** phisix API (live PSE quotes, all ~385 stocks) + PSE Edge `DisclosureCht.ax` (historical daily OHLCV for indicators). **Yahoo Finance `.PS` was abandoned — it has no live PSE data (frozen ~2019).**
- **Fundamentals:** PSE Edge scraper for market cap + shares; P/E / EPS / dividend yield via a key-gated external API (`src/lib/market/fundamentalsApi.ts`, EODHD default `TICKER.PSE` or Twelve Data — `FUNDAMENTALS_API_KEY`). With no key, fundamentals return null gracefully (PSE Edge doesn't expose P/E).
- **Dividends:** PSE Edge disclosure scraper (`src/lib/market/dividendDisclosures.ts`) parses cash-dividend Form 6-1 filings into the `dividends` table. The tracker (`/dividends`, `src/lib/dividends.ts`) ranks stocks by trailing-12-month yield and rates entries (`src/lib/dividendLogic.ts`: yield + RSI + AI verdict + SMA200 + upcoming record date; SELL verdict = AVOID as a value-trap guard). No API key needed — this is the authoritative free source for PSE dividends.
- **News:** RSS/news headline fetcher for sentiment
- **AI:** Provider abstraction — Gemini (primary) → Groq (fallback), auto-switched by env key. Default Groq model `llama-3.3-70b-versatile` (override via `GROQ_MODEL`). Signals are DB-cached (`signal_cache`, 4h) and logged (`signal_history`) for the accuracy tracker (`/api/signals/accuracy`).
- **Push Notifications:** Web Push via VAPID (`web-push` lib + service worker), NOT the legacy FCM server-key API. Keys: `PUBLIC_FCM_VAPID_KEY` + `VAPID_PRIVATE_KEY`.
- **PWA:** vite-plugin-pwa (`registerType: 'prompt'`) + service worker with a "new version" update banner (`PwaUpdater.astro`); push handlers in `public/push-sw.js`.

## Key Files
```
CLAUDE.md          — you are here (read every session)
TASKS.md           — all tasks with IDs, phases, status, dependencies
CURRENT.md         — what to work on RIGHT NOW (check this first)
.env.example       — all required environment variables documented
src/lib/           — shared utilities (supabase client, ai provider, data fetchers)
src/pages/         — Astro pages/routes
src/components/    — React components
```

## AI Provider Rule
Always use the abstraction in `src/lib/ai/index.ts`. Never call Gemini or Groq directly from components or pages. The function signature is:
```ts
analyzeStock(data: StockAnalysisInput): Promise<StockAnalysisResult>
```
For signals specifically, prefer `getOrComputeSignal()` in `src/lib/signals.ts` — it adds the DB cache, the accuracy log, and the SELL-flip push notification.

## Conventions
- All monetary values in PHP (Philippine Peso)
- Use the bare PSE ticker everywhere (e.g., `SM`, `BDO`) — phisix and PSE Edge both key on it; no exchange suffix
- Always show "This is not financial advice" disclaimer on signal pages
- Bilingual output: English with Filipino-friendly tone (no jargon without explanation)
- Component files: PascalCase (`StockCard.tsx`)
- Utility files: camelCase (`fetchStockData.ts`)
- Never commit `.env` — only `.env.example`

## How to Continue Work
1. Read `CURRENT.md` — it tells you the exact task and next step
2. Read `TASKS.md` — for full context on what's done and what's next
3. Complete the current task, mark it `[x]` in TASKS.md
4. Update CURRENT.md to the next task
5. Commit with message: `feat(TASK-XXX): description`

## Supabase Tables (live — see `docs/schema.sql`)
- `profiles` — id, display_name, avatar_url, `leaderboard_opt_in`
- `holdings` — user_id, ticker, qty, buy_price, buy_date
- `portfolio_cash` — user_id, cash (editable; powers Total Account Equity)
- `watchlist` — user_id, ticker, alert_price_above/below
- `paper_trades` — user_id, ticker, action, qty, price, traded_at
- `paper_balances` — user_id, balance (default ₱100,000)
- `balance_snapshots` — user_id, snapshot_date, total_value (leaderboard 7d/30d returns)
- `push_subscriptions` — user_id, endpoint, p256dh, auth (Web Push)
- `push_preferences` — user_id, ticker, enabled (per-stock alert opt-out)
- `advisor_alert_state` — user_id, signature (dedup for advisor push alerts)
- `signal_cache` — ticker, verdict, confidence, rationale, target/stop, above_sma200, rsi14, computed_at (4h shared cache)
- `signal_history` — ticker, verdict, confidence, price, created_at (accuracy tracker)
- `dividends` — edge_no (PK), ticker, amount (PHP/share), div_type, security_type, record_date, payment_date (scraped PSE Edge cash-dividend disclosures)
- `dividend_alert_state` — ticker, signature (dedup for STRONG-ENTRY dividend push alerts)
- `dca_dividend_credits` — user_id, edge_no (idempotency ledger so the DCA bot credits each dividend once)

## Advisor & crons
- **Advisor** (`/dashboard/advisor`, `src/lib/advisor.ts`): risk-managed buy/trim/exit + sizing from holdings + cash + signals + watchlist. Pure `computeAdvice()` is unit-tested.
- **Cron endpoints** (POST, guarded by `PUSH_NOTIFY_SECRET`, need `Content-Type: application/json`): `/api/cron/refresh-signals`, `/api/cron/snapshot-balances`, `/api/cron/advisor-alerts`, `/api/cron/sync-dividends` (`?sinceDays=365` backfills). See `docs/DEPLOY.md` for crontab.
- **Dividend tracker crons** (in-process scheduler): daily disclosure sync ~6:05pm PHT; STRONG-ENTRY push alerts 8:20am PHT weekdays (dedup via `dividend_alert_state`). Disable with `DISABLE_DIVIDEND_TRACKER=1`.

## Deploy
Push-to-`main` deploys via `.github/workflows/deploy.yml` (PM2 on a server). Full setup in `docs/DEPLOY.md`. Commits use `[skip ci]` until prod infra is configured. Run the latest `docs/schema.sql` on prod Supabase.
