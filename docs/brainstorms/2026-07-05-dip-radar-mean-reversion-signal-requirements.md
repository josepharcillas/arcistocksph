# Dip Radar — mean-reversion "buy the dip" signal

**Date:** 2026-07-05 · **Scope:** Standard · **Type:** feat (new read-only signal arm)

---

## Problem

ArciStocks' AI signal is a deliberate trend + momentum follower with an
anti-bullish bias (`src/lib/ai/prompt.ts`): a stock below its SMA50/200 with a
negative MACD reads as **bearish**, and the app effectively talks the user out of
buying it. But the user — a self-described inexperienced trader — naturally thinks
in **mean-reversion** terms: *"NIKL fell to ₱2.50, it's washed out, it'll bounce in
a few days."* That instinct is a real strategy (support-buying / mean reversion),
but undisciplined it becomes **catching a falling knife** — the #1 way retail
traders lose money.

Today the app has no way to engage with that instinct: it has no support/resistance
or recent-low detection (only RSI/MACD/SMA), so it can neither validate a genuine
oversold bounce nor warn that a "cheap" stock is still falling. The user is left to
act on gut with no second opinion.

## Goal

Give the user a **disciplined second opinion on a dip** — distinguish a *real
washed-out bounce setup* from a *falling knife* or a *value trap* — so their
instinct is validated when it's sound and checked when it isn't. Teach the "why"
in the process.

## Users & value

- **Primary:** the owner/inexperienced trader, checking a hunch before committing
  money (currently paper money).
- **Value:** turns "it can't go lower" (an unproven guess) into an evidenced
  verdict; builds judgment one stock at a time instead of encouraging knife-catching.

## What we're building

One core rating with two faces:

1. **Pressure-test (reactive).** Enter a ticker → a verdict with reasons. *"Is NIKL
   @ ₱2.50 a real bounce setup or a falling knife?"*
2. **Dip Radar (generative).** A list of liquid PSE stocks near their lows, each
   labeled — knives shown but honestly tagged, never disguised as a buy.

### The core rating — `bounceRating` (mirror of `dividendLogic.ts` `entryRating`)

A pure, unit-testable function scoring how much a stock looks like a genuine
oversold bounce **right now**. Ingredients:

- **Washed out** — price near a recent low (within X% of the 52-week / N-day low).
- **Oversold** — low RSI(14).
- **A turn** — confirmation the fall is pausing: MACD histogram turning up, and/or
  consecutive up ("green") days.
- **Trend context** — above/below SMA50 and SMA200.
- **Trap guard** — the cached AI verdict; `SELL` is an automatic AVOID (reuses the
  dividend tracker's value-trap logic).

Ratings:

| Rating | Meaning |
|---|---|
| ✅ **SETUP** | Oversold **and** showing a turn **and** not a trap. The disciplined "buy the dip". |
| ⏳ **WAIT** | Oversold but still falling (below SMA, MACD down). A knife — no bottom confirmed yet. |
| ⛔ **AVOID** | AI verdict SELL (value trap) or a clean downtrend. Don't catch it. |

Each verdict carries plain-English reasons (e.g. *"RSI 24 — very oversold, but still
below SMA50 and MACD falling → no turn yet, wait for a green day"*).

### Behavior

- **Dip Radar** scans the **liquid** universe only — reuses the `STOCK_MIN_TURNOVER`
  floor so thin names don't produce fictional setups — and shows SETUP / WAIT /
  AVOID inline (nothing hidden, nothing disguised).
- **Pressure-test** runs the same rating on a single user-supplied ticker with the
  full reason breakdown.
- Read-only. Surfaces analysis; places no trades.

## Scope boundaries

**In scope:** the `bounceRating` logic, the pressure-test input + verdict, the Dip
Radar page/list, the SETUP/WAIT/AVOID labeling and reasons.

**Out of scope (deliberate):**

- **No bounce-trading bot.** This is a read-only signal arm like `/dividends`. It
  does **not** touch the three running paper bots — their equity curves stay a clean
  baseline. A "bounce strategy bot" is a *separate future task* (same rule as
  TASK-079: behavior changes ship as new bots, after there's data worth preserving).
- **No change to the existing trend-following AI signal or its prompt.** Dip Radar
  is a parallel arm; it reads the cached AI verdict but doesn't alter it.
- Not wired into push alerts or the advisor in v1 (possible follow-up).

## Success criteria

- Given NIKL still falling (near low, RSI ~22, below SMA50/200, MACD down, AI SELL),
  Dip Radar rates it **AVOID/WAIT**, not a buy — the app's ethos holds.
- Given a genuinely oversold-and-turning liquid stock, it rates it **SETUP** with a
  clear reason.
- The user can pressure-test an arbitrary ticker and get a verdict + reasons in one
  step.
- `bounceRating` is covered by unit tests (SETUP / WAIT / AVOID boundaries, trap
  guard, thin-name exclusion) — same bar as `dividendLogic.test.ts`.

## Dependencies & assumptions

- **Recent-low input** comes from daily OHLCV history via PSE Edge `DisclosureCht`
  (`src/lib/market/pseedge.ts`) — the same data that already feeds RSI/MACD/SMA, so
  the ~1-year window needed for a 52-week low exists. (Verify exact window in planning.)
- Reuses existing indicators (`src/lib/market/indicators.ts`), the cached AI verdict
  (`signal_cache`), and the `STOCK_MIN_TURNOVER` liquidity floor.
- Closest existing pattern to copy: `src/lib/dividendLogic.ts` (`entryRating`) +
  `src/pages/dividends.astro` (server-fetch-in-frontmatter + rated list page).

## Outstanding questions (for planning)

- **Thresholds:** how near the low counts as "washed out" (e.g. within 5%?), the RSI
  cutoff (≤30? ≤35?), and what precisely counts as "a turn" (MACD histogram sign flip
  vs N green days). Propose defaults, tune later.
- **Recent-low window:** 52-week vs a shorter N-day low (or show both).
- **Surface:** standalone `/dip-radar` (or "Dip Radar" nav item) mirroring
  `/dividends`, vs folding the pressure-test into the existing stock detail page.
