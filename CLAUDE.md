# ArciStocks PH — AI Project Context

## What This Is
A Progressive Web App (PWA) for Filipino investors. It provides AI-powered buy/sell/hold signals for PSE-listed stocks, portfolio tracking, paper trading, a leaderboard, and push notifications. Built on top of the arcitools ecosystem.

## Stack
- **Framework:** Astro 5 + React 19 + TypeScript (strict)
- **Styling:** Tailwind CSS 4 — dark theme (slate-950 base, green/red accents)
- **Auth + DB:** Supabase — Google OAuth, Postgres
- **Market Data:** Yahoo Finance unofficial API (`.PS` suffix for PSE stocks, ~15min delay)
- **Fundamentals:** PSE Edge scraper (P/E, EPS, revenue)
- **News:** RSS/news headline fetcher for sentiment
- **AI:** Provider abstraction — Gemini (primary) → Groq (fallback), auto-switched by env key
- **Push Notifications:** Firebase Cloud Messaging (FCM) + Web Push API
- **PWA:** vite-plugin-pwa + service worker

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
Always use the abstraction in `src/lib/ai.ts`. Never call Gemini or Groq directly from components or pages. The function signature is:
```ts
analyzeStock(data: StockAnalysisInput): Promise<StockAnalysisResult>
```

## Conventions
- All monetary values in PHP (Philippine Peso)
- Stock tickers use `.PS` suffix for Yahoo Finance calls (e.g., `SM.PS`, `BDO.PS`)
- PSE ticker without suffix for display (e.g., `SM`, `BDO`)
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

## Supabase Tables (planned)
- `profiles` — user id, display_name, avatar_url
- `holdings` — user_id, ticker, qty, buy_price, buy_date
- `watchlist` — user_id, ticker, alert_price_above, alert_price_below
- `paper_trades` — user_id, ticker, action, qty, price, timestamp
- `paper_balances` — user_id, balance (default ₱100,000)
- `push_subscriptions` — user_id, endpoint, keys
