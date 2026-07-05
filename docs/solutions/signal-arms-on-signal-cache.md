# Pattern: parallel signal arms on `signal_cache`

**Learned:** 2026-07-06, building Dip Radar (GH #3). Generalizes the dividend tracker.

## The pattern

New "read-only signal features" (the dividend tracker, Dip Radar, and future arms
like sentiment) all share one shape. Follow it so a new arm can't contaminate the
running paper-trading bots' baseline:

1. **Persist the inputs additively on `signal_cache`.** The signal refresh
   (`getOrComputeSignal`, `src/lib/signals.ts`) already computes full technicals +
   `priceHistory` for every liquid ticker. Store whatever scalar your arm needs as a
   **new nullable column** at the existing `signal_cache.upsert` — e.g. `rsi14`,
   `turnover20d` (dividend tracker), `pct_from_low`, `macd_hist` (Dip Radar).
   - **Critical invariant:** never change `verdict` / `confidence`. The three bots
     (`autoTrade.ts`, `dcaBot.ts`) trade off those two fields only, so additive
     columns leave bot behavior — and its equity-curve baseline — untouched. This is
     the codebase's "experiment-purity" rule (behavior changes ship as *new* bots).
2. **Pure rating logic in its own lib, unit-tested.** `dividendLogic.ts:entryRating`
   → `bounceLogic.ts:bounceRating`. Data in → `{ rating, score, reasons[] }` out. No
   IO. Always include the **value-trap guard**: `verdict === 'SELL'` ⇒ AVOID. A high
   yield / a washed-out price both look attractive precisely when the market is
   pricing in real trouble.
3. **A board assembler** mirrors `dividends.ts:getDividendBoard` →
   `bounceBoard.ts:getBounceBoard`: read `signal_cache` for the whole universe (one
   query), join `fetchAllQuotes()` for live price, apply the `STOCK_MIN_TURNOVER`
   liquidity floor, rate + rank. The scanner never re-fetches per-stock history.
4. **A page** mirrors `dividends.astro` (server-fetch in frontmatter + dark table).
   Add the nav link in `Sidebar.tsx`.

## Gotchas

- **Schema-first deploy.** The `upsert` lists the new columns unconditionally.
  supabase-js doesn't throw on a missing column — it returns `{error}` — so on an
  un-migrated DB signals silently stop *caching* (recompute every call → AI-quota
  burn), rather than crashing. Apply `docs/schema.sql` before shipping the code
  (tracked for prod by GH #2).
- **Scanner data is only as fresh as the refresh.** Newly-added columns are null on
  pre-existing cache rows until the ticker is re-refreshed; the board tolerates nulls.
- **Fresh lows:** `pctFromLow` uses live price vs historical closes, so it can go
  negative when a stock prints a new low — handle `<= 0` explicitly (`bounceLogic.ts`).
- **Empty scanner is often correct.** If nothing liquid is oversold/near-low today,
  "no candidates" is the honest answer, not a bug.

## The product point (why the trap guard matters)

Dip Radar exists to serve the "it's washed out, it'll bounce" instinct *safely*. The
guardrails ARE the feature: SETUP requires an actual momentum turn (MACD ≥ 0), WAIT
is a still-falling knife, AVOID is the AI-SELL trap. Without them it's just a
falling-knife menu — the thing the app's trend-following ethos exists to prevent.
