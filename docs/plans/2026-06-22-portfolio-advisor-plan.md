# Portfolio-Aware Advisor — Implementation Plan

Source: `docs/brainstorms/2026-06-22-portfolio-advisor-requirements.md`
Resolved OQs: candidates = existing holdings (OQ1); sizing = allocate-toward-cap (OQ2); cap = 30% (OQ3).

## Architecture
Client-rendered island reusing existing data paths (no new tables, no new server endpoint). The risk logic is a **pure, unit-tested function** so the money math is verifiable.

- `src/lib/advisor.ts` — pure `computeAdvice(positions, cash, config)` → ordered actions (EXIT/TRIM/BUY/HOLD_CASH). (R3–R9)
- `src/lib/advisor.test.ts` — unit tests for the rules.
- `src/components/advisor/Advisor.tsx` — loads holdings (`holdings`) + cash (`portfolio_cash`), bulk prices (`/api/stocks`), per-holding signals (`/api/analyze`, cached), calls `computeAdvice`, renders. (R1, R2, R10, R12)
- `src/pages/dashboard/advisor.astro` — page (auth-gated under `/dashboard`).
- `src/components/layout/Sidebar.tsx` — add "Advisor" link.
- Alerts (R11) reuse existing push infra — out of this slice (the Signals SELL hook already notifies).

## Rules (v1)
- Cap = 30% of equity. Equity = cash + Σ(shares·price).
- **EXIT**: verdict SELL and P/L ≤ −40% → sell all (cut the dead loss, free cash).
- **TRIM**: weight > cap → sell down to cap (cut concentration, free cash).
- **BUY**: candidates = held positions with BUY signal and weight < cap; rank by confidence then most-underweight; allocate available cash (+ freed) toward the pick without breaching cap; whole shares only.
- **HOLD_CASH**: when no BUY candidate clears the bar or cash can't buy ≥1 share.

## Test plan
- Unit: EXIT on deep-loss SELL; TRIM on over-cap; BUY ranking + cap respect; HOLD_CASH fallback; the user's real portfolio shape (concentrated, small cash).
- Build + integration: Playwright logged-in render of `/dashboard/advisor` (no errors), action list present.
- Regression: full unit suite + ui-smoke.
