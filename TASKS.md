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

- [x] **TASK-035** — AI-ranked screener results *(DONE: "AI-rank top 5" button -> analyzes top filtered stocks, ranks by verdict+confidence with rationale; reuses cached /api/analyze)*
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

- [x] **TASK-039** *(manifest verified; generated missing icon-192/512 PNGs via scripts/generate-icons.mjs)*   — Verify vite-plugin-pwa config and web manifest
  - Check `astro.config.mjs` manifest section
  - Test: Chrome DevTools → Application → Manifest shows correctly
  - Size: XSmall

- [x] **TASK-040** — PWA install prompt component *(DONE: InstallPrompt.tsx, beforeinstallprompt banner, dismissable)*
  - File: `src/components/pwa/InstallPrompt.tsx`
  - Shows "Add to Home Screen" banner on mobile
  - Size: Small
  - Depends: TASK-039

- [ ] **TASK-041** — Firebase project setup + FCM VAPID key
  - Manual step: Firebase console → new project → Cloud Messaging → get VAPID key
  - Add to `.env`: `PUBLIC_FCM_VAPID_KEY`, `FCM_SERVER_KEY`
  - Size: XSmall (manual)

- [x] **TASK-042** — Push subscription registration (client-side)
  - File: `src/lib/push/subscribe.ts` (Web Push/VAPID; saves to `push_subscriptions`)
  - Functions: `subscribeToPush`, `unsubscribeFromPush`, `isPushSupported`, `getPermission`, `isSubscribed`
  - Code complete — runs once `PUBLIC_FCM_VAPID_KEY` is set (TASK-041)
  - Size: Small
  - Depends: TASK-039, TASK-041

- [x] **TASK-043** — Push trigger serverless function (sell signal)
  - Files: `src/pages/api/push/notify.ts` + `src/lib/push/send.ts`
  - POST guarded by `PUSH_NOTIFY_SECRET`; `notifyHoldersOfSignal()` fans out via
    `web-push` to all holders' subscriptions, respecting per-stock opt-out, prunes dead subs
  - SW push/notificationclick handlers in `public/push-sw.js` (imported into Workbox SW)
  - Code complete — runs once VAPID keys are set (TASK-041)
  - Size: Medium
  - Depends: TASK-042, TASK-029

- [x] **TASK-044** — Notification settings page
  - Files: `src/pages/dashboard/notifications.astro` + `src/components/pwa/NotificationSettings.tsx`
  - Master on/off + per-stock opt-in/out (`push_preferences` table, see schema.sql)
  - Size: Small
  - Depends: TASK-043

---

## Phase 8: Paper Trading

- [x] **TASK-045** — Paper trading account setup (₱100,000 virtual balance)
  - On first login, insert `paper_balances` row with `balance = 100000`
  - Size: XSmall
  - Depends: TASK-005

- [x] **TASK-046** — Simulated buy order
  - File: `src/components/paper/BuyOrderForm.tsx`
  - Deducts from `paper_balances`, inserts into `paper_trades`
  - Validates: sufficient balance, valid ticker
  - Size: Small
  - Depends: TASK-045

- [x] **TASK-047** — Simulated sell order
  - File: `src/components/paper/SellOrderForm.tsx`
  - Adds to `paper_balances`, inserts into `paper_trades`
  - Validates: user holds enough qty
  - Size: Small
  - Depends: TASK-046

- [x] **TASK-048** — Paper portfolio performance tracker
  - File: `src/components/paper/PaperPortfolio.tsx`
  - Shows: virtual holdings, current value, total return vs ₱100k baseline
  - Size: Small
  - Depends: TASK-046, TASK-047

- [x] **TASK-049** — Paper trade history log
  - File: `src/pages/dashboard/paper-trading.astro`
  - Table of all past paper trades with P&L per trade
  - Size: Small
  - Depends: TASK-048

---

## Phase 9: Leaderboard

- [x] **TASK-050** — Opt-in to leaderboard (display name setting)
  - Field: `profiles.leaderboard_opt_in` (boolean), `profiles.display_name`
  - Settings page toggle
  - Size: XSmall
  - Depends: TASK-005

- [x] **TASK-051** — Leaderboard computation (% return from ₱100k baseline)
  - DB view or function: rank users by `(paper_balance / 100000 - 1) * 100`
  - Size: Small
  - Depends: TASK-048, TASK-050

- [x] **TASK-052** — Leaderboard page
  - File: `src/pages/leaderboard.astro`
  - Public page (no login required to view)
  - Ranked list: rank, display name, % return, best trade
  - Size: Small
  - Depends: TASK-051

- [~] **TASK-053** *(deferred: needs daily balance snapshots; all-time ranking done)* — — Leaderboard time filters (weekly / monthly / all-time)
  - Filter computes return over the selected period
  - Size: Small
  - Depends: TASK-052

---

## Phase 10: UI Polish

- [ ] **TASK-054** — Install and configure shadcn/ui (Slate theme)
  - Base: slate-950 background, green-400 buy, red-400 sell, yellow-400 hold
  - Size: Small

- [x] **TASK-055** — Responsive sidebar navigation *(DONE: Sidebar.tsx — desktop sidebar + mobile bottom tab bar; Notifications link added)*
  - File: `src/components/layout/Sidebar.tsx`
  - Links: Portfolio, Signals, Screener, Watchlist, Paper Trading, Leaderboard, Notifications
  - Mobile: bottom tab bar
  - Size: Medium

- [x] **TASK-056** — Loading skeleton components *(DONE: ui/Skeleton.tsx (Skeleton + SkeletonCard); used in HoldingsList, SignalsFeed, PaperTrading, WatchlistManager, etc.)*
  - File: `src/components/ui/Skeleton.tsx`
  - Used on: stock cards, signal cards, leaderboard rows
  - Size: Small

- [x] **TASK-057** — Empty states *(DONE: friendly empty states across holdings/watchlist/signals/screener/leaderboard/paper)*
  - Friendly prompt to add first holding / first watchlist item
  - Size: XSmall

- [x] **TASK-058** — Error boundary + API error states *(DONE: error states in HoldingsList/SignalsFeed/StockDetail/Screener/Leaderboard; 429 handling)*
  - Graceful message when Yahoo Finance or AI provider fails
  - Size: Small

---

## Phase 11: Launch Prep

- [~] **TASK-059** — Production deployment (SSH + PM2, NOT Vercel)
  - Actual setup: `.github/workflows/deploy.yml` builds on push to `main` and scp's `dist/` to the server, runs under PM2 at stocks.arcitools.com
  - BLOCKERS: (1) workflow references `ecosystem.config.cjs` which does not exist in the repo → first deploy's `pm2 start` fails; (2) build step only passes `PUBLIC_SUPABASE_*` secrets — `GEMINI_API_KEY`/`GROQ_API_KEY` are absent at build, so AI may be disabled in prod (verify runtime env handling — see TASK-066)
  - Size: Small

- [x] **TASK-060** — SEO meta tags + Open Graph *(DONE: SEO.astro — title, description, OG, Twitter, theme-color, icons; wired into DashboardLayout)*
  - File: `src/components/SEO.astro`
  - OG image: dark card with ArciStocks PH logo
  - Size: Small

- [x] **TASK-061** — Rate limiting on API routes *(DONE: src/lib/rateLimit.ts in middleware — 60/min API, 10/min AI per IP; verified 429s)*
  - Prevent abuse of AI endpoint (max 10 req/min per user)
  - Size: Small

- [x] **TASK-062** — Final disclaimer page *(DONE: /disclaimer.astro, EN + Filipino)*
  - File: `src/pages/disclaimer.astro`
  - "Not financial advice" legal disclaimer in English and Filipino
  - Size: XSmall

- [x] **TASK-063** — Smoke test with 5 real PSE tickers *(DONE: scripts/smoke-tickers.mjs — authenticated HTTP path; SM/BDO/AC/TEL/JFC all PASS with live prices, RSI/SMA, headlines + AI signals. NOTE: "JGSOC" isn't a valid PSE symbol — JG Summit is `JGS`; used JFC instead.)*
  - Test: SM, BDO, JFC, AC, TEL
  - Verify: data fetches, AI signals generate, push notification triggers
  - Size: Small

---

## Summary

*Reconciled 2026-06-22 against `src/` (verified by tests, not just reading). "done" counts only fully-working tasks; `[~]` partials are noted separately.*

| Phase | Tasks | Status |
|---|---|---|
| 0 — Setup | TASK-001 to 008 | 6/8 done (002, 003 = manual prod Supabase/OAuth, pending) |
| 1 — AI Provider | TASK-009 to 013 | 5/5 done |
| 2 — Market Data | TASK-014 to 021 | done (free phisix + PSE Edge stack; verified live) |
| 3 — Portfolio | TASK-022 to 027 | done (holdings + stock detail; verified) |
| 4 — AI Signals | TASK-028 to 031 | done (DB-cached via TASK-069) |
| 5 — Screener | TASK-032 to 035 | 4/4 done ✓ (incl. AI-ranked picks) |
| 6 — Watchlist | TASK-036 to 038 | 3/3 done ✓ |
| 7 — PWA + Push | TASK-039 to 044 | icons+install+update-prompt done; push 042-044 code-complete (041 = generate VAPID keys, manual) |
| 8 — Paper Trading | TASK-045 to 049 | 5/5 done ✓ |
| 9 — Leaderboard | TASK-050 to 053 | 3/4 done (053 time-filters deferred — needs daily snapshots) |
| 10 — UI Polish | TASK-054 to 058 | done except 054 shadcn (deferred — current styling is consistent) |
| 11 — Launch | TASK-059 to 063 | SEO/rate-limit/disclaimer/smoke-test done; 059 deploy needs prod infra (docs/DEPLOY.md) |
| 12 — Critical Fixes & Gaps | TASK-064 to 075 | done (064/065/066/068 verified fixed; 071 fixed + tested; 067/069/070/072/073/074/075 prior) |
| **Total** | **75 tasks** | **all done except: 002/003 (manual prod), 041 (VAPID keys), 054 (shadcn, deferred), 053 (deferred), 059 (deploy infra)** |

---

## Phase 12: Critical Fixes & Gaps (NEW — added during 2026-06-14 audit)

> These came out of reading the actual code. The first three are hard blockers:
> the app cannot work end-to-end until they're fixed. Do this phase before Phase 5+.

### 🔴 Blockers — app does not work without these

- [x] **TASK-064** — Fix holdings insert (missing `user_id`) *(DONE: AddHoldingForm.tsx gets `supabase.auth.getUser()` and includes `user_id`; verified by e2e-db.mjs RLS insert/read. Same pattern in watchlist/paper.)*
  - File: `src/components/portfolio/AddHoldingForm.tsx`
  - Size: XSmall

- [x] **TASK-065** — Fix auth session storage mismatch (login loop) *(DONE: `@supabase/ssr` cookie-based clients (supabase.ts createBrowserClient + supabase-server.ts); middleware reads the same cookie. Verified by e2e-auth.mjs: login cookie accepted by middleware, /dashboard redirect → /login only when unauthenticated.)*
  - Files: `src/lib/supabase.ts`, `src/lib/supabase-server.ts`, `src/middleware.ts`
  - Size: Medium

- [x] **TASK-066** — Make AI keys available at runtime in production *(DONE: ai/index.ts reads `import.meta.env[key] ?? process.env[key]` at request time; PM2 `--env-file=.env` loads server secrets. Verified: smoke-tickers.mjs gets real Groq signals from the built server.)*
  - Files: `src/lib/ai/index.ts`, `ecosystem.config.cjs`
  - Size: Small

- [x] **TASK-067** — Add `ecosystem.config.cjs` for PM2 *(DONE: dist/server/entry.mjs under PM2, --env-file=.env for runtime secrets. NOTE: full deploy still needs prod Supabase + server .env + CI secrets set.)*
  - File: `ecosystem.config.cjs` (repo root)
  - Bug: `deploy.yml` scp's and `pm2 start ecosystem.config.cjs`, but the file doesn't exist → deploy fails on a fresh server.
  - Fix: add PM2 config pointing at `dist/server/entry.mjs` with `HOST`/`PORT` and env file loading.
  - Size: XSmall

### 🟠 High — features silently broken / data wrong

- [x] **TASK-068** — Build the stock detail page (`/stock/[ticker]`) *(DONE: stock/[ticker].astro + StockDetail.tsx — live price, technicals, AI signal, loading/error states. Verified /stock/SM = 200 and smoke-tickers fetches each.)*
  - File: `src/pages/stock/[ticker].astro`
  - Size: Medium

- [x] **TASK-069** — Wire signal caching to the `signal_cache` table *(DONE: /api/analyze reads/writes signal_cache (4h, shared across users via service role). Verified: 1.9s->117ms on cache hit.)*
  - Replace the in-memory Map in `api/analyze.ts` with read/write to `signal_cache` (4h TTL). Cuts AI calls across users/restarts and protects the Gemini free-tier quota.
  - Size: Small

- [x] **TASK-070** — Fix PSE Edge fundamentals scraper *(DONE: resolves cmpyId, extracts real Market Cap + Outstanding Shares + Par from the company page th/td table. P/E & Book Value are blank on PSE Edge outside live sessions -> null by design.)*
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

- [x] **TASK-071** — Unit tests for finance math + AI parsing *(DONE: vitest — indicators.test.ts + prompt.test.ts, 15 tests. Also FIXED the three correctness nits below.)*
  - Cover `indicators.ts` (RSI/MACD/SMA), `prompt.ts` `parseAIResponse` (malformed JSON, bad verdicts).
  - Correctness fixes applied: RSI now uses **Wilder's smoothing** over the full series (with a textbook known-value test ≈70.46); MACD signal line is an **EMA over the full MACD series** (not just the last 9); `computeSMA` now **averages the available data** when there's < period (instead of returning the current price).
  - Size: Medium

- [x] **TASK-072** — Rate-limit public API routes *(DONE via middleware — see TASK-061)*
  - `api/stock/[ticker].ts` is unauthenticated and hits Yahoo on every call — open to abuse. Add the rate limiting from TASK-061 here too, and decide whether it needs auth. (Folds in TASK-061.)
  - Size: Small

- [x] **TASK-073** — Error states for data/AI failures in the UI *(DONE — see TASK-058)*
  - HoldingsList swallows per-stock fetch errors and shows "—" with no retry; no global handling when Yahoo/AI is down. Add visible error + retry (this is TASK-058, promoted because the data sources are flaky by design).
  - Size: Small
