# feat: Dip Radar — mean-reversion "buy the dip" signal

**Origin:** `docs/brainstorms/2026-07-05-dip-radar-mean-reversion-signal-requirements.md` · GH #3
**Depth:** Standard · **Type:** feat (read-only signal arm)

---

## Summary

A disciplined dip detector with two faces on one shared rating: a **Dip Radar**
scanner (liquid PSE stocks near their lows, each tagged SETUP / WAIT / AVOID) and a
**pressure-test** (type a ticker → verdict + reasons). Mirrors the dividend tracker's
`entryRating` pattern. Read-only; touches no bot behavior.

## Definition of done (from #3 acceptance criteria)

- NIKL still-falling (near low, low RSI, below SMA, AI SELL) → rated **AVOID/WAIT**, never a buy.
- A genuinely oversold-and-turning liquid stock → **SETUP** with a clear reason.
- User can pressure-test an arbitrary ticker → verdict + reasons in one step.
- `bounceRating` unit-tested (SETUP/WAIT/AVOID boundaries, trap guard, thin-name exclusion), same bar as `dividendLogic.test.ts`.

## Key technical decision — where the scanner's data comes from

The dividend board reads everything from `signal_cache` (no per-stock history
re-fetch). Dip Radar does the same, but the rating needs two inputs the cache
doesn't carry yet: **proximity to the recent low** and **a momentum turn (MACD)**.

Both are already computed in `getOrComputeSignal` (`src/lib/signals.ts:52-61`,
`stockData.technicals` + `priceHistory` are in hand). So: **persist two new additive
columns** on `signal_cache` at that existing write:
- `pct_from_low` — `(price − trailingLow) / trailingLow × 100`, low taken over the
  full ~1yr `priceHistory` (≈ 52-week low). Small = washed out.
- `macd_hist` — `technicals.macd.histogram`. ≥ 0 = momentum turned up (the SETUP signal).

These are **additive and do not change `verdict`/`confidence`** — the three paper
bots read only those, so this respects the experiment-purity rule (same shape as the
earlier `rsi14` / `turnover20d` additions). No bot behavior changes.

The **pressure-test** path fetches full `getStockData(ticker)` for the one typed
ticker and computes the rating from live technicals directly (+ cached verdict), so
it works for any ticker even before it's in the scan cache.

## Resolved open questions (defaults; env-overridable)

| Question | Default | Env |
|---|---|---|
| "Washed out" = within X% of low | ≤ 10% | `BOUNCE_NEAR_LOW_PCT=10` |
| Oversold RSI gate | ≤ 35 (≤30 scores higher) | `BOUNCE_RSI_MAX=35` |
| "A turn" | `macd_hist ≥ 0` | — |
| Recent-low window | full available history (~52wk) | — |
| Surface | standalone `/dip-radar` + nav item (mirrors `/dividends`), pressure-test input on same page | — |

## Rating rules — `bounceRating` (SETUP / WAIT / AVOID)

Mirrors `entryRating` structure. Given `{ rsi14, pctFromLow, macdHist, aboveSma200, verdict, nearLowPct, rsiMax }`:

1. **AVOID** if `verdict === 'SELL'` — value-trap / downtrend guard (reuses the
   dividend logic's rationale: "AI signal is SELL — likely a falling knife / trap").
2. Else must qualify as a dip at all: `pctFromLow ≤ nearLowPct` **or** `rsi14 ≤ rsiMax`; otherwise **WAIT** (not a dip / not oversold).
3. Qualified dips split on the turn:
   - **SETUP** = oversold/near-low **and** `macdHist ≥ 0` (turning up). Score adds for depth (rsi ≤30, pctFromLow ≤5) and `aboveSma200`.
   - **WAIT** = oversold/near-low but `macdHist < 0` (still falling — knife, no bottom confirmed).

Each verdict returns plain-English `reasons[]` (e.g. *"RSI 24 — very oversold, but MACD still falling → no turn yet, wait for a green day"*). Ranking in the board: SETUP → WAIT → AVOID, then by score desc.

## Files

**New:**
- `src/lib/bounceLogic.ts` — pure `bounceRating()` + `pctFromLow()` helper. Unit-tested.
- `src/lib/bounceLogic.test.ts` — SETUP/WAIT/AVOID boundaries, trap guard, thin-name (via board), missing-data.
- `src/lib/bounceBoard.ts` — assembler mirroring `dividends.ts getDividendBoard`: read `signal_cache` (now incl. `pct_from_low`, `macd_hist`) for liquid tickers (`turnover20d ≥ STOCK_MIN_TURNOVER`), join `fetchAllQuotes`, rate + rank. `getBounceForTicker(ticker)` for the pressure-test (uses `getStockData` + cached verdict).
- `src/pages/dip-radar.astro` — server-fetch board in frontmatter + SETUP/WAIT/AVOID list; mirrors `dividends.astro` dark-table styling.
- `src/pages/api/dip-radar/[ticker].ts` — GET pressure-test endpoint (rate-limited via existing middleware).
- `src/components/bounce/DipPressureTest.tsx` — small React island: ticker input → calls the API → shows verdict + reasons.

**Edit:**
- `docs/schema.sql` — `alter table signal_cache add column if not exists pct_from_low numeric; ... macd_hist numeric;` + migration comment.
- `src/lib/signals.ts` — compute + persist `pct_from_low`, `macd_hist` in the existing `signal_cache.upsert` (and surface on `SignalWithMeta`).
- `src/components/layout/Sidebar.tsx` — add "Dip Radar" nav link.
- `.env.example` — document `BOUNCE_NEAR_LOW_PCT`, `BOUNCE_RSI_MAX`.

## Out of scope (per #3)

- **No bounce-trading bot** — read-only tool; the 3 running bots are untouched. A bounce bot is a separate future task.
- No change to the AI signal prompt / verdict.
- Not wired to push/advisor in v1.

## Test / verify

- Unit: `bounceLogic.test.ts` green (same bar as `dividendLogic.test.ts`).
- `npm run build` + `npm test` green.
- Browser: `/dip-radar` renders the labeled list; pressure-test a ticker (e.g. a known oversold one) → verdict + reasons; confirm a SELL-verdict stock shows AVOID.
