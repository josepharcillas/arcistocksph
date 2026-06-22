# feat: Advisor enhancements — new-stock candidates, risk sizing, push alerts

*Plan date: 2026-06-22 · Origin: `docs/brainstorms/2026-06-22-portfolio-advisor-requirements.md` (OQ1, OQ2, R11) + signal-accuracy follow-up.*

## Summary
Extend the portfolio advisor along the three deferred axes, plus plan (not build) the signal-accuracy lever. Builds on the shipped `src/lib/advisor.ts` + `/dashboard/advisor`.

## Scope
- **U1 — Risk-based position sizing (OQ2).** Size buys by equity-at-risk to a stop-loss, falling back to allocate-to-cap when no usable stop. Pure-lib change + tests.
- **U2 — New-stock buy candidates (OQ1).** Consider the user's **watchlist** stocks (not just holdings) as buy candidates, under the same risk/cap rules. Mostly a component change; lib already handles zero-weight candidates.
- **U3 — Advisor push alerts (R11).** A guarded cron computes each push-subscribed user's advice server-side and pushes the headline action when it changes (dedup state table).
- **U4 — Signal accuracy (planned, BLOCKED).** Add fundamentals as a data source and/or `ce-optimize` the prompt against the accuracy tracker. **Blocked**: needs a fundamentals data-source decision (no free PSE source) and accrued accuracy data. Not built this pass.

## Key Technical Decisions
- **Risk sizing reuses the signal's `stopLoss`.** `riskPerShare = price − stopLoss`; `shares = min(capRoom, cash, riskBudget/riskPerShare)`. Falls back to cap-sizing when stopLoss is missing or ≥ price. Keeps `computeAdvice` deterministic. (R9)
- **New candidates come from the watchlist, not the whole market.** Bounded (no 385-stock AI fan-out); the user already curates it. Held positions stay primary. Zero-share candidates are already eligible in `computeAdvice` (weight 0 < cap). (R6)
- **Alerts dedup on the headline action signature.** Push only when the top actionable recommendation (first non-`HOLD_CASH`) changes; store last signature per user. Avoids spam and overlaps cleanly with existing signal alerts.

## Implementation Units

### U1. Risk-based position sizing
- **Files:** `src/lib/advisor.ts`, `src/lib/advisor.test.ts`
- **Approach:** Add `stopLoss` to `AdvisorPosition`; add `sizing: 'cap'|'risk'` and `riskPerTradePct` to `AdvisorConfig` (default `cap` to preserve existing behavior/tests). In the BUY pass compute shares as the min of cap-room, cash, and (risk mode) risk-budget shares.
- **Test scenarios:** risk mode sizes by stop distance; falls back to cap when stopLoss missing/≥price; never exceeds cap or cash; cap mode unchanged (existing tests stay green).

### U2. New-stock buy candidates from watchlist
- **Files:** `src/components/advisor/Advisor.tsx`, `src/lib/advisor.ts` (add `isHolding` to position view), `src/lib/advisor.test.ts`
- **Approach:** Component also loads watchlist tickers, fetches their signal + price, includes them as positions with `shares: 0`. `computeAdvice` already treats them as eligible buys; add `isHolding` so the UI badges new picks "NEW".
- **Test scenarios:** a zero-share watchlist stock with a BUY signal becomes a buy candidate; held stocks still rank; `isHolding` reflects shares>0.

### U3. Advisor push alerts
- **Files:** `src/pages/api/cron/advisor-alerts.ts`, `docs/schema.sql` (`advisor_alert_state`), reuse `src/lib/advisor.ts` + `src/lib/push/send.ts`
- **Approach:** Guarded POST (`PUSH_NOTIFY_SECRET`). For each user with push subscriptions: load holdings + cash + watchlist, read signals from `signal_cache`, fetch quotes once, `computeAdvice`, take the headline action, compare to stored signature, push + upsert on change. Document the crontab entry.
- **Test scenarios:** unit — headline-signature derivation (HOLD_CASH → no alert; EXIT/TRIM/BUY → signature). Integration — endpoint auth 401; authed run returns a summary without error.

### U4. Signal accuracy (BLOCKED — plan only)
- **Decision needed:** a fundamentals data source (free scrape = fragile/ToS, or a paid API) and/or ~1 week of accuracy-tracker data before `ce-optimize`. Not implemented this pass.

## Test plan
Unit: extend `advisor.test.ts` (risk sizing, watchlist candidate, headline signature). Integration: Playwright advisor page still renders with watchlist candidates; cron endpoint auth + run. Regression: full unit suite + ui-smoke.
