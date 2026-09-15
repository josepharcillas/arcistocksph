# Pattern: an AI narrative layer over existing pure logic

**Learned:** 2026-07-06, building the Portfolio-page AI analysis (GH #5, Phase 2 of #4).

## The pattern

To add "AI analysis + recommendations" to a page that already has deterministic
logic, **compose over the existing pure functions — don't fork or mutate them.**
`/api/portfolio/insights` does exactly this:

1. **Reuse `computeAdvice` unchanged.** The risk model (`src/lib/advisor.ts`) already
   turns positions + cash into EXIT/TRIM/BUY/HOLD_CASH actions and is consumed by
   the advisor-alerts cron (via `headlineSignature`). The insights endpoint calls it
   as-is and only *reads* its output. **Never change its action selection** to add a
   feature — that would shift `headlineSignature` and perturb the alert dedup. Enrich
   additively (dividend context, a narrative) around it, exactly like the
   [[signal-arms-on-signal-cache]] experiment-purity rule for the bots.
2. **Reuse the pure dividend helpers.** `dividendLogic.ts` exports
   `ttmDividendPerShare`, `nextUpcomingDividend`, `dedupeDividendEvents` — call them
   per held ticker for a focused query rather than computing the whole
   `getDividendBoard`. Recurring (non-`Special`) yield only, so a one-off special
   doesn't inflate "income".
3. **The narrative is the only new AI call.** A separate `analyzePortfolio()` mirrors
   the `src/lib/ai` provider abstraction (Gemini → Groq fallback, `responseMimeType` /
   `response_format` JSON, `thinkingBudget: 0`). News needs no separate fetch — it's
   already baked into each stock's cached signal verdict, so the narrative inherits it
   through the per-position verdicts it's given.
4. **Do the composition server-side, hand the client a thin render.** The endpoint
   assembles quotes + signals + dividends + advice + narrative; `PortfolioInsights.tsx`
   just POSTs its holdings and renders. This avoided duplicating the Advisor page's
   heavy client-side data loader.

## Gotchas

- **Cache the expensive part, and bound the cache.** Only the AI narrative is costly.
  Cache it in-process keyed by the exact book + cash with a TTL — but a naive `Map`
  grows one entry per distinct portfolio state forever. Add a size cap that drops the
  oldest key (`cache.delete(cache.keys().next().value)`), or a long-running server
  leaks memory.
- **Don't leak raw model output on the fallback path.** When sanitizing a JSON
  response, a "matched JSON but the field was blank/non-string" case must return the
  safe default — NOT fall through to returning the raw JSON string. A unit test on the
  pure parse function caught this (same lesson as [[gemini-vision-screenshot-parse]]'s
  `Number(null) === 0`).
- **Shared presentation goes in one module.** The EXIT/TRIM/BUY/HOLD_CASH Tailwind
  class maps are now `src/components/advisor/actionStyles.ts`, imported by both the
  Advisor page and the Portfolio card, so they can't drift.

## Reuse

Any "AI read of a page's data" feature (a watchlist digest, a paper-trading recap)
follows this shape: compose over the existing pure logic, add one cached+bounded AI
call, keep news implicit via signals, render thin.
