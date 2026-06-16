# ArciStocks PH — Master Task List

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

> **Status reconciled 2026-06-14** against the actual `src/` tree. Phases 0–4 are
> largely coded but **not verified working** — see **Phase 12: Critical Fixes & Gaps**
> for three bugs that currently block the app end-to-end (auth loop, holdings insert,
> broken deploy). Do Phase 12 before building more features.

---

## Phase 0: Project Setup

- [x] **TASK-001** — Install dependencies (`npm install`) and verify dev server runs
  - Command: `npm install && npm run dev`
  - Acceptance: `http://localhost:4321` loads without errors
  - Size: XSmall

- [ ] **TASK-002** — Create Supabase project and get credentials
  - Steps: Go to supabase.com → new project → copy URL + anon key → add to `.env`
  - Acceptance: `.env` has `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`
  - Size: XSmall (manual step by user)

- [ ] **TASK-003** — Enable Google OAuth in Supabase
  - Steps: Supabase dashboard → Auth → Providers → Google → enable → add Client ID + Secret from Google Cloud Console
  - Acceptance: Google login button triggers OAuth flow
  - Size: XSmall (manual step by user)

- [x] **TASK-004** — Create Supabase client singleton
  - File: `src/lib/supabase.ts`
  - Exports: `supabase` client instance
  - Size: XSmall
  - Depends: TASK-002

- [x] **TASK-005** — Create DB schema migration (Supabase SQL editor) *(schema.sql also adds `signal_cache`; not yet applied to a live project — TASK-002 pending)*
  - Tables: `profiles`, `holdings`, `watchlist`, `paper_trades`, `paper_balances`, `push_subscriptions`
  - File: `docs/schema.sql` (for reference)
  - Size: Small
  - Depends: TASK-002

- [x] **TASK-006** — Build Google sign-in page
  - File: `src/pages/login.astro` + `src/components/LoginButton.tsx`
  - Acceptance: Click → Google OAuth → redirect to `/dashboard`
  - Size: Small
  - Depends: TASK-003, TASK-004

- [x] **TASK-007** — Auth callback route + session handling
  - File: `src/pages/auth/callback.astro`
  - Acceptance: After OAuth, user is authenticated and redirected to `/dashboard`
  - Size: Small
  - Depends: TASK-006

- [x] **TASK-008** — Protected route middleware
  - File: `src/middleware.ts`
  - Acceptance: Unauthenticated users redirected to `/login` on protected pages
  - Size: Small
  - Depends: TASK-007

---

## Phase 1: AI Provider Abstraction

- [x] **TASK-009** — Define AI types and interface
  - File: `src/lib/ai/types.ts`
  - Exports: `StockAnalysisInput`, `StockAnalysisResult` types
  - Size: XSmall

- [x] **TASK-010** — Implement Gemini provider
  - File: `src/lib/ai/gemini.ts`
  - Uses: `GEMINI_API_KEY` env var, Gemini 1.5 Flash model
  - Size: Small
  - Depends: TASK-009

- [x] **TASK-011** — Implement Groq provider
  - File: `src/lib/ai/groq.ts`
  - Uses: `GROQ_API_KEY` env var, llama-3.1-8b-instant model
  - Size: Small
  - Depends: TASK-009

- [x] **TASK-012** — Auto-switch provider logic + main analyzeStock function
  - File: `src/lib/ai/index.ts`
  - Logic: if `GEMINI_API_KEY` set → Gemini, else if `GROQ_API_KEY` → Groq, else throw
  - Exports: `analyzeStock(data): Promise<StockAnalysisResult>`
  - Size: XSmall
  - Depends: TASK-010, TASK-011

- [x] **TASK-013** — Astro API endpoint wrapping AI call
  - File: `src/pages/api/analyze.ts`
  - Accepts: POST `{ ticker, priceHistory, technicals, fundamentals, news }`
  - Returns: `{ verdict, rationale, confidence }`
  - Size: Small
  - Depends: TASK-012

---

## Phase 2: Market Data Layer

- [x] **TASK-014** — ~~Yahoo Finance fetcher~~ → **replaced** by `phisix.ts` (live quotes) + `pseedge.ts` (history). See TASK-074. Yahoo had no live PSE data.
  - File: `src/lib/market/yahoo.ts`
  - Function: `fetchPriceHistory(ticker: string, days: number): Promise<OHLCV[]>`
  - Note: Append `.PS` to ticker for Yahoo (e.g., `SM` → `SM.PS`)
  - Size: Small

- [x] **TASK-015** — Compute RSI (14-period) from price array
  - File: `src/lib/market/indicators.ts`
  - Function: `computeRSI(closes: number[], period?: number): number`
  - Size: Small

- [x] **TASK-016** — Compute MACD from price array
  - File: `src/lib/market/indicators.ts`
  - Function: `computeMACD(closes: number[]): { macd, signal, histogram }`
  - Size: Small

- [x] **TASK-017** — Compute SMA (20, 50, 200-day) from price array
  - File: `src/lib/market/indicators.ts`
  - Function: `computeSMA(closes: number[], period: number): number`
  - Size: XSmall

- [~] **TASK-018** — PSE Edge scraper *(history DONE via DisclosureCht.ax — TASK-074; fundamentals P/E still null — TASK-070)*
  - File: `src/lib/market/pseedge.ts`
  - Function: `fetchFundamentals(ticker: string): Promise<Fundamentals>`
  - Returns: `{ pe, eps, revenue, bookValue, dividendYield }`
  - Note: Scrape `edge.pse.com.ph` company profile page
  - BUG: endpoint uses `cmpy_id=<ticker>`, but PSE Edge keys on a numeric company id, not the ticker → always returns empty. Needs ticker→cmpy_id resolution.
  - Size: Medium

- [x] **TASK-019** — News headline fetcher for sentiment *(fixed 2026-06-14: Google News dropped CDATA wrapping → old regex matched 0; now parses plain `<title>`. Verified 8 real headlines for JFC.)*
  - File: `src/lib/market/news.ts`
  - Function: `fetchHeadlines(ticker: string): Promise<string[]>`
  - Source: Google News RSS or Philippine Star / BusinessWorld RSS
  - Size: Small

- [x] **TASK-020** — Combined stock data aggregator
  - File: `src/lib/market/index.ts`
  - Function: `getStockData(ticker: string): Promise<StockAnalysisInput>`
  - Calls: TASK-014 + TASK-015-017 + TASK-018 + TASK-019
  - Size: Small
  - Depends: TASK-014 through TASK-019

- [x] **TASK-021** — Astro API endpoint: GET stock data
  - File: `src/pages/api/stock/[ticker].ts`
  - Caches result for 15 minutes (Yahoo Finance delay)
  - Size: Small
  - Depends: TASK-020

---

## Phase 3: Portfolio Feature

- [x] **TASK-022** — Dashboard page skeleton
  - File: `src/pages/dashboard/index.astro`
  - Layout: sidebar nav + main content area
  - Size: Small
  - Depends: TASK-008

- [x] **TASK-023** — Portfolio holdings list component
  - File: `src/components/portfolio/HoldingsList.tsx`
  - Shows: ticker, qty, buy price, current price, P&L, % change
  - Size: Small
  - Depends: TASK-022

- [~] **TASK-024** — Add holding form + Supabase insert *(BUG: insert omits `user_id` → fails NOT NULL + RLS — see TASK-064)*
  - File: `src/components/portfolio/AddHoldingForm.tsx`
  - Fields: ticker (PSE), qty, buy price, buy date
  - Size: Small
  - Depends: TASK-005, TASK-023

- [~] **TASK-025** — Edit / delete holding *(delete done in HoldingsList; edit not built)*
  - File: `src/components/portfolio/HoldingActions.tsx`
  - Size: XSmall
  - Depends: TASK-024

- [x] **TASK-026** — Portfolio summary card (total value, total P&L)
  - File: `src/components/portfolio/PortfolioSummary.tsx`
  - Size: Small
  - Depends: TASK-023

- [x] **TASK-027 / TASK-068** — Individual stock detail page *(BUILT 2026-06-15: `src/pages/stock/[ticker].astro` + `StockDetail.tsx` — live price, sparkline, technicals, fundamentals, news, AI signal. Serves 200.)*
  - File: `src/pages/stock/[ticker].astro`
  - Shows: price chart, technicals, fundamentals, AI signal
  - Size: Medium
  - Depends: TASK-021, TASK-013

---

## Phase 4: AI Signals

- [x] **TASK-028** — Signal card component (BUY/SELL/HOLD badge + rationale)
  - File: `src/components/signals/SignalCard.tsx`
  - Shows: verdict badge (green/red/yellow), AI rationale text, timestamp
  - Size: Small

- [~] **TASK-029** — Generate signals for all portfolio holdings *(done differently: `SignalsFeed.tsx` fans out client-side to `/api/analyze` per ticker; no `api/signals/portfolio.ts` endpoint. Fine for now, but N requests from the browser.)*
  - File: `src/pages/api/signals/portfolio.ts`
  - Loops holdings → calls analyzeStock for each → returns array
  - Size: Small
  - Depends: TASK-013, TASK-028

- [x] **TASK-030** — Signals dashboard page
  - File: `src/pages/dashboard/signals.astro`
  - Lists all current buy/sell/hold signals for user's holdings
  - Size: Small
  - Depends: TASK-029

- [~] **TASK-031** — Signal result caching (Supabase table) *(table exists in schema.sql but UNUSED — `api/analyze.ts` caches in an in-memory Map that dies on every serverless cold start and isn't shared. Wire it to `signal_cache` — see TASK-067)*
  - Table: `signal_cache` (ticker, verdict, rationale, computed_at)
  - Expire after 4 hours to avoid re-calling AI on every visit
  - Size: Small
  - Depends: TASK-029

---

## Phase 5: Stock Screener

- [x] **TASK-032** — PSEi 30 stock list (seed data) *(DONE: `src/data/psei30.ts` — 30 stocks + sector map)*
  - File: `src/data/psei30.ts`
  - Array of `{ ticker, name, sector }` for the 30 index stocks
  - Size: XSmall

- [x] **TASK-033** — Full PSE stock list *(DONE differently: no static JSON needed — `GET /api/stocks` pulls all ~385 live from phisix in one call, cached 15m. Screener uses this.)*
  - File: `src/pages/api/stocks.ts`
  - Source: phisix bulk snapshot
  - Size: Medium

- [x] **TASK-034** — Screener page with filter UI *(DONE: `src/pages/screener.astro` + `Screener.tsx` — search, sector (PSEi 30), max-price filter, sortable columns, links to detail page. Verified 385 stocks load.)*
  - File: `src/pages/screener.astro` + `src/components/screener/Screener.tsx`
  - Filters: sector dropdown, max price, search by ticker/name; sortable
  - Size: Medium
  - Depends: TASK-032, TASK-033

- [ ] **TASK-035** — AI-ranked screener results
  - After filtering, send top 20 results to AI for ranking + brief rationale per stock
  - Size: Medium
  - Depends: TASK-034, TASK-013

---

## Phase 6: Watchlist

- [x] **TASK-036** — Watchlist CRUD (add/remove stocks to watch) *(DONE 2026-06-15: `WatchlistManager.tsx`; RLS insert/read verified)*
  - File: `src/components/watchlist/WatchlistManager.tsx`
  - Supabase table: `watchlist`
  - Size: Small
  - Depends: TASK-005

- [x] **TASK-037** — Watchlist dashboard page *(DONE: `dashboard/watchlist.astro` — live price + day change per row)*
  - File: `src/pages/dashboard/watchlist.astro`
  - Shows current price, day change, AI signal for each watched stock
  - Size: Small
  - Depends: TASK-036

- [x] **TASK-038** — Price alert conditions per watchlist entry *(DONE: inline above/below ₱ inputs, in-app ⚠ triggered badge. Push delivery is Phase 7.)*
  - Fields: `alert_price_above`, `alert_price_below` (nullable)
  - UI: inline edit on watchlist row
  - Size: Small
  - Depends: TASK-037

---

## Phase 7: PWA + Push Notifications

- [ ] **TASK-039** — Verify vite-plugin-pwa config and web manifest
  - Check `astro.config.mjs` manifest section
  - Test: Chrome DevTools → Application → Manifest shows correctly
  - Size: XSmall

- [ ] **TASK-040** — PWA install prompt component
  - File: `src/components/pwa/InstallPrompt.tsx`
  - Shows "Add to Home Screen" banner on mobile
  - Size: Small
  - Depends: TASK-039

- [ ] **TASK-041** — Firebase project setup + FCM VAPID key
  - Manual step: Firebase console → new project → Cloud Messaging → get VAPID key
  - Add to `.env`: `PUBLIC_FCM_VAPID_KEY`, `FCM_SERVER_KEY`
  - Size: XSmall (manual)

- [ ] **TASK-042** — Push subscription registration (client-side)
  - File: `src/lib/push/subscribe.ts`
  - Function: `subscribeToPush(): Promise<void>`
  - Saves subscription to Supabase `push_subscriptions` table
  - Size: Small
  - Depends: TASK-039, TASK-041

- [ ] **TASK-043** — Push trigger serverless function (sell signal)
  - File: `src/pages/api/push/notify.ts`
  - Triggered when a SELL signal is generated for a user's holding
  - Sends push via FCM to all user's subscriptions
  - Size: Medium
  - Depends: TASK-042, TASK-029

- [ ] **TASK-044** — Notification settings page
  - File: `src/pages/dashboard/notifications.astro`
  - Per-stock opt-in/out for push alerts
  - Size: Small
  - Depends: TASK-043

---

## Phase 8: Paper Trading

- [ ] **TASK-045** — Paper trading account setup (₱100,000 virtual balance)
  - On first login, insert `paper_balances` row with `balance = 100000`
  - Size: XSmall
  - Depends: TASK-005

- [ ] **TASK-046** — Simulated buy order
  - File: `src/components/paper/BuyOrderForm.tsx`
  - Deducts from `paper_balances`, inserts into `paper_trades`
  - Validates: sufficient balance, valid ticker
  - Size: Small
  - Depends: TASK-045

- [ ] **TASK-047** — Simulated sell order
  - File: `src/components/paper/SellOrderForm.tsx`
  - Adds to `paper_balances`, inserts into `paper_trades`
  - Validates: user holds enough qty
  - Size: Small
  - Depends: TASK-046

- [ ] **TASK-048** — Paper portfolio performance tracker
  - File: `src/components/paper/PaperPortfolio.tsx`
  - Shows: virtual holdings, current value, total return vs ₱100k baseline
  - Size: Small
  - Depends: TASK-046, TASK-047

- [ ] **TASK-049** — Paper trade history log
  - File: `src/pages/dashboard/paper-trading.astro`
  - Table of all past paper trades with P&L per trade
  - Size: Small
  - Depends: TASK-048

---

## Phase 9: Leaderboard

- [ ] **TASK-050** — Opt-in to leaderboard (display name setting)
  - Field: `profiles.leaderboard_opt_in` (boolean), `profiles.display_name`
  - Settings page toggle
  - Size: XSmall
  - Depends: TASK-005

- [ ] **TASK-051** — Leaderboard computation (% return from ₱100k baseline)
  - DB view or function: rank users by `(paper_balance / 100000 - 1) * 100`
  - Size: Small
  - Depends: TASK-048, TASK-050

- [ ] **TASK-052** — Leaderboard page
  - File: `src/pages/leaderboard.astro`
  - Public page (no login required to view)
  - Ranked list: rank, display name, % return, best trade
  - Size: Small
  - Depends: TASK-051

- [ ] **TASK-053** — Leaderboard time filters (weekly / monthly / all-time)
  - Filter computes return over the selected period
  - Size: Small
  - Depends: TASK-052

---

## Phase 10: UI Polish

- [ ] **TASK-054** — Install and configure shadcn/ui (Slate theme)
  - Base: slate-950 background, green-400 buy, red-400 sell, yellow-400 hold
  - Size: Small

- [ ] **TASK-055** — Responsive sidebar navigation
  - File: `src/components/layout/Sidebar.tsx`
  - Links: Dashboard, Signals, Screener, Watchlist, Paper Trading, Leaderboard
  - Mobile: bottom tab bar
  - Size: Medium
  - Depends: TASK-054

- [ ] **TASK-056** — Loading skeleton components
  - File: `src/components/ui/Skeleton.tsx`
  - Used on: stock cards, signal cards, leaderboard rows
  - Size: Small

- [ ] **TASK-057** — Empty states (no holdings, no watchlist, etc.)
  - Friendly prompt to add first holding / first watchlist item
  - Size: XSmall

- [ ] **TASK-058** — Error boundary + API error states
  - Graceful message when Yahoo Finance or AI provider fails
  - Size: Small

---

## Phase 11: Launch Prep

- [~] **TASK-059** — Production deployment (SSH + PM2, NOT Vercel)
  - Actual setup: `.github/workflows/deploy.yml` builds on push to `main` and scp's `dist/` to the server, runs under PM2 at stocks.arcitools.com
  - BLOCKERS: (1) workflow references `ecosystem.config.cjs` which does not exist in the repo → first deploy's `pm2 start` fails; (2) build step only passes `PUBLIC_SUPABASE_*` secrets — `GEMINI_API_KEY`/`GROQ_API_KEY` are absent at build, so AI may be disabled in prod (verify runtime env handling — see TASK-066)
  - Size: Small

- [ ] **TASK-060** — SEO meta tags + Open Graph image
  - File: `src/components/SEO.astro`
  - OG image: dark card with ArciStocks PH logo
  - Size: Small

- [ ] **TASK-061** — Rate limiting on API routes
  - Prevent abuse of AI endpoint (max 10 req/min per user)
  - Size: Small

- [ ] **TASK-062** — Final disclaimer page
  - File: `src/pages/disclaimer.astro`
  - "Not financial advice" legal disclaimer in English and Filipino
  - Size: XSmall

- [ ] **TASK-063** — Smoke test with 5 real PSE tickers
  - Test: SM, BDO, JGSOC, AC, TEL
  - Verify: data fetches, AI signals generate, push notification triggers
  - Size: Small

---

## Summary

*Reconciled 2026-06-14 against `src/`. "done" counts only fully-working tasks; `[~]` partials are noted separately.*

| Phase | Tasks | Status |
|---|---|---|
| 0 — Setup | TASK-001 to 008 | 6/8 done (002, 003 = manual, pending) |
| 1 — AI Provider | TASK-009 to 013 | 5/5 done |
| 2 — Market Data | TASK-014 to 021 | 7/8 done (018 scraper broken) |
| 3 — Portfolio | TASK-022 to 027 | 3/6 done (024, 025 partial; 027 not built) |
| 4 — AI Signals | TASK-028 to 031 | 2/4 done (029, 031 partial) |
| 5 — Screener | TASK-032 to 035 | 0/4 done |
| 6 — Watchlist | TASK-036 to 038 | 3/3 done ✓ |
| 7 — PWA + Push | TASK-039 to 044 | 0/6 done (manifest configured) |
| 8 — Paper Trading | TASK-045 to 049 | 0/5 done |
| 9 — Leaderboard | TASK-050 to 053 | 0/4 done |
| 10 — UI Polish | TASK-054 to 058 | partial (Sidebar + Skeleton built ahead of phase) |
| 11 — Launch | TASK-059 to 063 | 0/5 done (059 deploy partial/blocked) |
| **12 — Critical Fixes & Gaps** | **TASK-064 to 073** | **0/10 done — DO FIRST** |
| **Total** | **73 tasks** | **~23 fully done** |

---

## Phase 12: Critical Fixes & Gaps (NEW — added during 2026-06-14 audit)

> These came out of reading the actual code. The first three are hard blockers:
> the app cannot work end-to-end until they're fixed. Do this phase before Phase 5+.

### 🔴 Blockers — app does not work without these

- [ ] **TASK-064** — Fix holdings insert (missing `user_id`)
  - File: `src/components/portfolio/AddHoldingForm.tsx`
  - Bug: `supabase.from('holdings').insert({ ticker, qty, buy_price, buy_date })` omits `user_id`. Schema has `user_id ... not null` + RLS `with check (auth.uid() = user_id)`, so every insert fails.
  - Fix: get the session user (`supabase.auth.getUser()`) and include `user_id`. Same gap will hit watchlist/paper_trades — fix the pattern once.
  - Size: XSmall

- [ ] **TASK-065** — Fix auth session storage mismatch (login loop)
  - Files: `src/lib/supabase.ts`, `src/pages/auth/callback.astro`, `src/middleware.ts`
  - Bug: browser client stores the session in **localStorage** (supabase-js default), but `middleware.ts` reads it from a **cookie** (`sb-…-auth-token`). So SSR-protected `/dashboard` never sees a session → redirects a logged-in user back to `/login` forever. The hand-rolled cookie regex also won't handle Supabase's base64/chunked cookie format.
  - Fix: adopt `@supabase/ssr` with cookie-based storage (server + browser clients), or make the whole dashboard client-rendered and drop SSR auth gating. Decide one model and apply consistently.
  - Size: Medium

- [ ] **TASK-066** — Make AI keys available at runtime in production
  - Files: `src/lib/ai/index.ts`, `.github/workflows/deploy.yml`, ecosystem/env on server
  - Bug: provider selection reads `import.meta.env.GEMINI_API_KEY`. Vite can inline `import.meta.env.*` at build; the deploy build doesn't pass the AI keys, so they may resolve to `undefined` in prod → "No AI provider configured". 
  - Fix: read server secrets via `process.env` at request time (node adapter), and ensure PM2/`ecosystem.config.cjs` loads them from a server-side `.env`. Verify with a prod smoke test.
  - Size: Small

- [ ] **TASK-067** — Add `ecosystem.config.cjs` for PM2 (unblock deploy)
  - File: `ecosystem.config.cjs` (repo root)
  - Bug: `deploy.yml` scp's and `pm2 start ecosystem.config.cjs`, but the file doesn't exist → deploy fails on a fresh server.
  - Fix: add PM2 config pointing at `dist/server/entry.mjs` with `HOST`/`PORT` and env file loading.
  - Size: XSmall

### 🟠 High — features silently broken / data wrong

- [ ] **TASK-068** — Build the stock detail page (`/stock/[ticker]`)
  - File: `src/pages/stock/[ticker].astro`
  - HoldingsList and SignalCard already link here; today it 404s. This is really TASK-027 — promoted because existing UI depends on it.
  - Size: Medium

- [ ] **TASK-069** — Wire signal caching to the `signal_cache` table
  - Replace the in-memory Map in `api/analyze.ts` with read/write to `signal_cache` (4h TTL). Cuts AI calls across users/restarts and protects the Gemini free-tier quota.
  - Size: Small

- [ ] **TASK-070** — Fix PSE Edge fundamentals scraper (ticker → cmpy_id)
  - File: `src/lib/market/pseedge.ts`
  - `cmpy_id=<ticker>` is wrong; PSE Edge needs a numeric company id. Resolve ticker→id first (PSE Edge has a company search endpoint), then scrape. Until then, fundamentals are always empty and the AI prompt shows all "N/A".
  - Size: Medium

### 🔴🔴 SHOWSTOPPER — found during live testing 2026-06-14

- [x] **TASK-074** — Replace the dead Yahoo Finance data source *(DONE + verified live 2026-06-14: `phisix.ts` quotes + `pseedge.ts` history/resolve; `getStockData` rewired; `yahoo.ts` deleted; CLAUDE.md updated. `/api/stock/{SM,BDO,ALI,JFC}` return 202 real candles + computed RSI/MACD/SMA + live price + news headlines. Remaining: fundamentals P/E still null — PSE Edge stockData.do doesn't expose it → folds into TASK-070.)*
  - Files: `src/lib/market/yahoo.ts`, `src/lib/market/index.ts`, CLAUDE.md (`.PS` convention)
  - Discovery: Yahoo Finance does **not** carry live PSE data. `SM.PS` resolves to a *mutual fund* on a phantom "YHD" exchange, `currency: null`, last price **June 2019**. Symbol search for PSE names returns only US OTC pink-sheet proxies (SVTMF, AYAAF). So `fetchPriceHistory` returns **0 points** → no indicators, no signals, no P&L. The entire market-data layer is non-functional against real PSE tickers.
  - Verified working replacements:
    - **phisix-api3.appspot.com** — `GET /stocks/SM.json` returns live PHP price + %change + volume, `as_of` = today. (Current quote only, no history. `phisix-api4` is currently 503 — use api3, handle fallback.)
    - **PSE Edge** — `GET /autoComplete/searchCompanyNameSymbol.ax?term=SM` (with `X-Requested-With: XMLHttpRequest`) returns `cmpyId` (SM=599). Needed for fundamentals + historical chart data.
  - ✅ **VERIFIED FREE DATA STACK (tested live 2026-06-14, all returning current data):**
    - **Live quotes (all 385 PSE stocks in ONE call):** `GET https://phisix-api3.appspot.com/stocks.json`
      → `{ stocks: [{ symbol, name, price:{currency,amount}, percentChange, volume }], as_of }`. SM = ₱643.50 today. Use for portfolio prices, screener, watchlist. (Single-stock: `/stocks/<TICKER>.json`. `phisix-api4` currently 503 — keep api3 primary, api4 fallback.)
    - **Historical OHLCV (for RSI/MACD/SMA) via PSE Edge — 3 steps:**
      1. `GET /autoComplete/searchCompanyNameSymbol.ax?term=SM` (header `X-Requested-With: XMLHttpRequest`) → `cmpyId` (SM=599)
      2. `GET /companyPage/stockData.do?cmpy_id=599` → scrape `security_id` (SM=520) from the page (`security_id = "520"`)
      3. `POST /common/DisclosureCht.ax` JSON `{cmpy_id, security_id, startDate:"MM-DD-YYYY", endDate:"MM-DD-YYYY"}` → `{chartData:[{CHART_DATE,OPEN,HIGH,LOW,CLOSE,VALUE}]}`. Returned **249 daily rows** for SM (full year). All on `https://edge.pse.com.ph`, free, no key.
    - **Fundamentals:** same PSE Edge company page (cmpyId) — fixes TASK-070's broken lookup at the same time.
  - Work: rewrite `yahoo.ts` → `phisix.ts` (quotes) + extend `pseedge.ts` (cmpyId/securityId resolve + DisclosureCht history + fundamentals); cache securityId lookups; update `getStockData`; update CLAUDE.md (drop the `.PS`/Yahoo convention).
  - Size: Large — **this gates the whole product**; nothing downstream is real without it.

- [x] **TASK-075** — Fix `schema.sql` signup trigger + missing grants *(done + verified on local Supabase 2026-06-14)*
  - Two latent bugs that would break **production** auth, caught by live testing:
    - `handle_new_user` referenced unqualified `profiles` with no `search_path` → GoTrue signup failed with *"Database error creating new user"* (HTTP 500). Real Google logins would all fail. Fixed: `public.profiles` + `set search_path = public`.
    - Tables had no `SELECT/INSERT/...` grants for `anon`/`authenticated` → PostgREST returned *"permission denied"*. Fixed: added standard grants + default privileges.
  - Verified: full signup → profile-trigger → RLS-scoped insert/read now passes (`scripts/e2e-db.mjs`).

### 🟡 Medium — correctness, safety, quality

- [ ] **TASK-071** — Unit tests for finance math + AI parsing
  - Add Vitest. Cover `indicators.ts` (RSI/MACD/SMA against known series), `prompt.ts` `parseAIResponse` (malformed JSON, bad verdicts), and P&L math. This code drives money decisions and is currently untested.
  - Note correctness nits while here: MACD signal line is an EMA over only the last 9 MACD values (should run over the full series); RSI uses a simple average, not Wilder's smoothing; `computeSMA` returns the current price when there's < period of data (makes SMA50/200 misleading for new listings).
  - Size: Medium

- [ ] **TASK-072** — Rate-limit + protect public API routes
  - `api/stock/[ticker].ts` is unauthenticated and hits Yahoo on every call — open to abuse. Add the rate limiting from TASK-061 here too, and decide whether it needs auth. (Folds in TASK-061.)
  - Size: Small

- [ ] **TASK-073** — Error states for data/AI failures in the UI
  - HoldingsList swallows per-stock fetch errors and shows "—" with no retry; no global handling when Yahoo/AI is down. Add visible error + retry (this is TASK-058, promoted because the data sources are flaky by design).
  - Size: Small
