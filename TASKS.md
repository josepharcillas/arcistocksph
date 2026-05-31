# ArciStocks PH — Master Task List

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

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

- [x] **TASK-005** — Create DB schema migration (Supabase SQL editor)
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

- [x] **TASK-014** — Yahoo Finance fetcher for PSE price history
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

- [x] **TASK-018** — PSE Edge fundamentals scraper
  - File: `src/lib/market/pseedge.ts`
  - Function: `fetchFundamentals(ticker: string): Promise<Fundamentals>`
  - Returns: `{ pe, eps, revenue, bookValue, dividendYield }`
  - Note: Scrape `edge.pse.com.ph` company profile page
  - Size: Medium

- [x] **TASK-019** — News headline fetcher for sentiment
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

- [ ] **TASK-022** — Dashboard page skeleton
  - File: `src/pages/dashboard/index.astro`
  - Layout: sidebar nav + main content area
  - Size: Small
  - Depends: TASK-008

- [ ] **TASK-023** — Portfolio holdings list component
  - File: `src/components/portfolio/HoldingsList.tsx`
  - Shows: ticker, qty, buy price, current price, P&L, % change
  - Size: Small
  - Depends: TASK-022

- [ ] **TASK-024** — Add holding form + Supabase insert
  - File: `src/components/portfolio/AddHoldingForm.tsx`
  - Fields: ticker (PSE), qty, buy price, buy date
  - Size: Small
  - Depends: TASK-005, TASK-023

- [ ] **TASK-025** — Edit / delete holding
  - File: `src/components/portfolio/HoldingActions.tsx`
  - Size: XSmall
  - Depends: TASK-024

- [ ] **TASK-026** — Portfolio summary card (total value, total P&L)
  - File: `src/components/portfolio/PortfolioSummary.tsx`
  - Size: Small
  - Depends: TASK-023

- [ ] **TASK-027** — Individual stock detail page
  - File: `src/pages/stock/[ticker].astro`
  - Shows: price chart, technicals, fundamentals, AI signal
  - Size: Medium
  - Depends: TASK-021, TASK-013

---

## Phase 4: AI Signals

- [ ] **TASK-028** — Signal card component (BUY/SELL/HOLD badge + rationale)
  - File: `src/components/signals/SignalCard.tsx`
  - Shows: verdict badge (green/red/yellow), AI rationale text, timestamp
  - Size: Small

- [ ] **TASK-029** — Generate signals for all portfolio holdings
  - File: `src/pages/api/signals/portfolio.ts`
  - Loops holdings → calls analyzeStock for each → returns array
  - Size: Small
  - Depends: TASK-013, TASK-028

- [ ] **TASK-030** — Signals dashboard page
  - File: `src/pages/dashboard/signals.astro`
  - Lists all current buy/sell/hold signals for user's holdings
  - Size: Small
  - Depends: TASK-029

- [ ] **TASK-031** — Signal result caching (Supabase table)
  - Table: `signal_cache` (ticker, verdict, rationale, computed_at)
  - Expire after 4 hours to avoid re-calling AI on every visit
  - Size: Small
  - Depends: TASK-029

---

## Phase 5: Stock Screener

- [ ] **TASK-032** — PSEi 30 stock list (hardcoded seed data)
  - File: `src/data/psei30.ts`
  - Array of `{ ticker, name, sector }` for the 30 index stocks
  - Size: XSmall

- [ ] **TASK-033** — Full PSE stock list (JSON seed data)
  - File: `src/data/pse-stocks.json`
  - ~300 entries: `{ ticker, name, sector }`
  - Source: Scrape or manually compile from PSE Edge
  - Size: Medium

- [ ] **TASK-034** — Screener page with filter UI
  - File: `src/pages/screener.astro` + `src/components/screener/ScreenerFilters.tsx`
  - Filters: sector dropdown, price range slider, search by ticker/name
  - Size: Medium
  - Depends: TASK-032, TASK-033

- [ ] **TASK-035** — AI-ranked screener results
  - After filtering, send top 20 results to AI for ranking + brief rationale per stock
  - Size: Medium
  - Depends: TASK-034, TASK-013

---

## Phase 6: Watchlist

- [ ] **TASK-036** — Watchlist CRUD (add/remove stocks to watch)
  - File: `src/components/watchlist/WatchlistManager.tsx`
  - Supabase table: `watchlist`
  - Size: Small
  - Depends: TASK-005

- [ ] **TASK-037** — Watchlist dashboard page
  - File: `src/pages/dashboard/watchlist.astro`
  - Shows current price, day change, AI signal for each watched stock
  - Size: Small
  - Depends: TASK-036

- [ ] **TASK-038** — Price alert conditions per watchlist entry
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

- [ ] **TASK-059** — Vercel deployment setup
  - `vercel.json` config, environment variables in Vercel dashboard
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

| Phase | Tasks | Status |
|---|---|---|
| 0 — Setup | TASK-001 to 008 | 0/8 done |
| 1 — AI Provider | TASK-009 to 013 | 0/5 done |
| 2 — Market Data | TASK-014 to 021 | 0/8 done |
| 3 — Portfolio | TASK-022 to 027 | 0/6 done |
| 4 — AI Signals | TASK-028 to 031 | 0/4 done |
| 5 — Screener | TASK-032 to 035 | 0/4 done |
| 6 — Watchlist | TASK-036 to 038 | 0/3 done |
| 7 — PWA + Push | TASK-039 to 044 | 0/6 done |
| 8 — Paper Trading | TASK-045 to 049 | 0/5 done |
| 9 — Leaderboard | TASK-050 to 053 | 0/4 done |
| 10 — UI Polish | TASK-054 to 058 | 0/5 done |
| 11 — Launch | TASK-059 to 063 | 0/5 done |
| **Total** | **63 tasks** | **0/63 done** |
