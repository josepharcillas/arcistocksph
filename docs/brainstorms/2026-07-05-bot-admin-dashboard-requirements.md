---
date: 2026-07-05
topic: bot-admin-dashboard
---

# Bot Admin Dashboard + Transaction Log

## Summary

A single owner-only page that shows the three paper-trading bots (STOCK AI,
CRYPTO AI, DCA 🐢) side by side — headline stats, each against its buy-and-hold
benchmark, an equity-curve chart, and an expandable per-bot log of every
transaction with the bot's reason. Replaces running `scripts/scoreboard.mjs` in a
terminal with an at-a-glance view in the app.

## Problem Frame

The bots are a live experiment answering "do ArciStocks' picks make money?" Today
the only way to read that experiment is `node scripts/scoreboard.mjs`, and the
only way to see what a bot actually did is to query the database by hand. There's
no view of *why* a bot bought or sold — the reason each bot produces per run is
discarded, so the trade history can't be judged, only tallied.

## Key Decisions

- **Observability, not behavior change.** This work only reads bot state; it
  changes nothing about how the bots trade. It's the safe half of the backlog —
  the strategy changes (TASK-079/080) are deferred and out of scope here.
- **Owner-only access.** The page is gated to the owner's email
  (`joseph.arcillas26@gmail.com`); there is no admin role in the app, and bot
  performance is a private experiment, not a user feature. Non-owners are
  redirected.
- **One page, not two.** Dashboard on top, per-bot transaction log expandable
  below — a single route, not a separate log page.
- **Reason persisted forward.** The bots' decision reason isn't stored today.
  Add a column and save it from now on; historical trades render "—". No attempt
  to reconstruct past reasons.
- **Shared stats source.** Win-rate and benchmark math currently lives only in
  `scripts/scoreboard.mjs`. Extract it so the page and the script compute
  identical numbers rather than drifting.

## Requirements

**Access**

- R1. The page is reachable only by the signed-in owner (email allowlist);
  anyone else is redirected away and sees none of the bot data.

**Dashboard**

- R2. Show all three bots in one view, each with: equity, return % vs the ₱10,000
  start, cash, open positions, trade count, win rate, and realized P/L.
- R3. Show each bot against its buy-and-hold benchmark — AI CRYPTO vs BTC-hold,
  the stock bots vs the equal-weight PSEi-30 basket — including the bot-vs-benchmark
  gap, matching what `scripts/scoreboard.mjs` reports.
- R4. Show a per-bot equity-curve chart from `balance_snapshots`.
- R5. Reflect current data on load; a manual refresh is sufficient (no live
  streaming required).

**Transaction log**

- R6. Below the dashboard, each bot has an expandable log of its transactions,
  newest first: date, action (BUY / SELL / DIVIDEND), ticker, quantity, price,
  and peso value.
- R7. The log merges trades (`paper_trades`) and dividend credits
  (`dca_dividend_credits`) into one timeline per bot.
- R8. Each transaction shows the bot's reason when one was recorded; transactions
  from before reason-persistence render "—".

**Shared stats**

- R9. Win-rate and benchmark calculations are computed from one shared source used
  by both the page and `scripts/scoreboard.mjs`, so the two never disagree.

## Acceptance Examples

- AE1. **Covers R8.** A BUY the STOCK bot made yesterday (before the reason column
  existed) shows "—" in the reason cell; a BUY it makes after this ships shows its
  recorded rationale (e.g. "BUY signal confirmed 24h + above SMA200"). Both appear
  in the same log.
- AE2. **Covers R7.** The DCA bot's log interleaves its weekly BUYs with DIVIDEND
  rows credited from `dca_dividend_credits`, ordered purely by date.

## Scope Boundaries

**In scope**
- Read-only dashboard + transaction log for the three existing bots.
- Adding a reason column and persisting it going forward.
- Extracting shared stats math out of the scoreboard script.

**Out of scope**
- Any change to how the bots trade (TASK-079/080 — deferred, and to be built as
  new bots).
- Controls to start/stop/reset bots from the page.
- A general admin role or multi-user admin access.
- Backfilling reasons for past trades.

## Dependencies / Assumptions

- Assumes the owner's identity is available server-side on the page request (the
  app already uses cookie-based SSR auth), so the email gate can run before render.
- `getBotState('stock'|'crypto')` and `getDcaState()` already return
  cash/equity/holdings/pnl/config/equityCurve/recentTrades; assumed sufficient for
  the dashboard, extended only where win-rate/benchmark math must be shared.
- The reason column addition is a forward-only schema change; no data migration.

## Outstanding Questions

**Deferred to planning**
- Exact win-rate definition to standardize on (the scoreboard already computes one
  — reuse it verbatim rather than redefining).
- Charting approach for the equity curve (reuse whatever the existing pages use).
- Whether the shared stats module is consumed by the script via import or via the
  page's API route.

## Sources

- `scripts/scoreboard.mjs` — current 3-bot stats, win-rate replay, benchmarks.
- `src/lib/autoTrade.ts` (`getBotState`) and `src/lib/dcaBot.ts` (`getDcaState`) —
  per-bot read-only state.
- `src/lib/dcaBot.ts` — `paper_trades` insert (no reason) + `dca_dividend_credits`
  crediting; `docs/schema.sql` — `paper_trades` columns.
- `docs/DEPLOY.md` / existing dashboard pages — cookie-SSR auth pattern for the
  email gate.
