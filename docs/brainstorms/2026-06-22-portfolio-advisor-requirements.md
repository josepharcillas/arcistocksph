# Portfolio-Aware Advisor — Requirements

*Brainstorm date: 2026-06-22*

## Summary

A portfolio-aware advisor that, given the user's real PSE holdings and available cash, recommends specific actions — how much cash to put into which stock, and which positions to trim or exit — using **risk and concentration rules rather than price prediction**. It surfaces alerts when an action becomes worthwhile. Advisory only: the user executes trades in their own broker.

## Problem Frame

The user trades a real, concentrated PSE portfolio that is currently down ~21% (≈97% in three stocks, one position −90%) with little free cash (~₱1,244 buying power). The original wish — "always suggest correctly" — isn't achievable; no tool predicts prices reliably. The achievable, valuable version is decision support that manages risk and sizing: it tells the user where (if anywhere) to deploy limited cash and what to cut, with reasons they can see.

## Key Decisions

- **Risk-managed basis.** Recommendations weigh each stock's signal *alongside* portfolio concentration and position risk. The advisor may recommend buying nothing. Chosen over "chase the strongest signal" and over "average down losers" to avoid deepening losses in a concentrated, falling portfolio.
- **Buy + sell/trim, not buy-only.** Because available cash is small, freeing cash by exiting dead or oversized positions is part of the recommendation.
- **Manual portfolio input.** Holdings and cash are entered by the user (no broker API); advice reflects the latest input.
- **Concentration cap (default ~25–30% of equity).** Adding to a position already above the cap is discouraged; actions that reduce concentration are preferred.
- **Honesty constraints.** Every recommendation shows the underlying signal confidence and a "not financial advice" notice, and defers to the signal-accuracy track record. The advisor never claims certainty.

## Actors

- **Investor (user)** — maintains holdings + cash, reviews recommendations/alerts, executes trades in their own broker.
- **Advisor (system)** — computes recommendations from holdings, cash, live prices, signals, and risk rules.

## Requirements

**Portfolio inputs**
- **R1** — The user can record current holdings (ticker, shares, average cost) and available cash. *(Reuses existing holdings + portfolio_cash.)*
- **R2** — The advisor computes per-position current value, weight (% of equity), and unrealized P/L from live prices.

**Buy recommendations**
- **R3** — Given available cash, the advisor recommends how much to allocate and to which stock(s), in whole shares affordable within cash.
- **R4** — A buy recommendation must respect the concentration cap: it does not recommend adding to a position already above the cap, and prefers actions that reduce concentration.
- **R5** — The advisor may recommend "hold cash / no buy" when no candidate clears the combined risk + signal bar.
- **R6** — Candidates may include existing holdings and, optionally, new stocks with strong risk-adjusted signals. *(See OQ1.)*

**Sell / trim recommendations**
- **R7** — The advisor flags positions to exit or trim based on risk (e.g., deep losers with a weak signal, or positions above the concentration cap), to cut risk and free cash.
- **R8** — Each sell/trim recommendation states the reason and the cash it would free.

**Sizing**
- **R9** — "How much to invest" is derived from a stated sizing rule and shown as a ₱ amount and a whole-share count. *(Exact method — see OQ2.)*

**Transparency & alerts**
- **R10** — Each recommendation shows the stock's signal verdict + confidence and a "not financial advice" notice.
- **R11** — The user is alerted (push) when a new actionable recommendation arises for a held or watched stock. *(Reuses existing push infrastructure.)*

**Output**
- **R12** — A single "Advisor" view summarizes current allocation + risk, recommended buys (₱ + shares), recommended trims/exits (with freed cash), or "no action."

## Key Flows

1. User opens the Advisor → app loads holdings + cash + live prices + per-stock signals.
2. App computes weights, unrealized P/L, risk flags, and concentration breaches.
3. App produces, in order: trims/exits (reason + freed cash), then buys (pick + ₱ + shares) sized within available cash plus any freed cash, never breaching the cap; or "no action."
4. Each item links to the stock detail and shows signal confidence + disclaimer.
5. Optional: a push alert fires when an actionable change appears; the user opens the Advisor and executes the trade in their broker.

## Scope Boundaries

**Deferred:** broker sync/import (no COL API), automated order execution, fees/tax modeling, backtested optimization of the sizing rule, per-sector limits.
**Outside this product's identity:** anything that executes real trades or implies guaranteed returns.

## Dependencies / Assumptions

- Reuses existing pieces: `src/components/portfolio/` (holdings, `portfolio_cash`), `src/pages/api/stock/[ticker].ts` (live price), the signal pipeline (`src/lib/signals.ts`, `src/pages/api/analyze.ts`, `signal_cache`), and push infrastructure (`src/lib/push/`).
- Assumes manual, reasonably-current holdings/cash input.
- Assumes the AI signal is directional input only; its accuracy is unproven until `signal_history` accrues data, so recommendations are decision support, not advice.
- Concentration cap defaults to ~25–30% of equity; configurable later.

## Success Criteria

- For a concentrated, down portfolio with small cash, the advisor produces a clear, risk-aware action set (or "no action") that never recommends breaching the concentration cap and never recommends averaging into a deep loser with a weak signal.
- Recommendations are reproducible from the stated rules — the user can see *why*.
- Every recommendation carries confidence + the disclaimer.

## Outstanding Questions

- **OQ1 (R6)** — v1 candidates: existing holdings only, or also surface new stocks from the screener?
- **OQ2 (R9)** — sizing method: allocate-toward-cap vs risk-based (fixed % of equity risked via a stop-loss)?
- **OQ3** — concentration cap exact value (25% vs 30%); whether per-sector limits matter later.
