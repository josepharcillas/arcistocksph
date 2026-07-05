# feat: Bot admin dashboard + transaction log

**Origin:** `docs/brainstorms/2026-07-05-bot-admin-dashboard-requirements.md`
**Depth:** Standard · **Type:** feat

---

## Summary

An owner-only page at `/dashboard/bots` showing the three paper-trading bots
(STOCK AI, CRYPTO AI, DCA 🐢) side by side — equity, return %, cash, positions,
trade count, win rate, realized P/L, each vs its buy-and-hold benchmark, plus a
per-bot equity sparkline and an expandable transaction log. Read-only; changes
nothing about how the bots trade. Also adds a persisted `reason` on trades so the
log can show *why* each trade happened going forward.

---

## Problem Frame

Reading the bot experiment today means running `node scripts/scoreboard.mjs` in a
terminal, and seeing what a bot actually did means hand-querying Supabase. The
per-run decision reason each bot produces is discarded, so trade history can only
be tallied, never judged. This plan surfaces the same numbers in the app and
preserves the reason from now on. Win-rate and benchmark math currently live only
in the script; the page must not fork them.

---

## Requirements Traceability

- R1 — owner-only access (email gate) → U4
- R2 — headline stats per bot → U3, U4
- R3 — each bot vs benchmark (BTC / PSEi-30 basket) → U2, U3, U4
- R4 — per-bot equity-curve chart → U4
- R5 — current-on-load, manual refresh acceptable → U4
- R6 — expandable per-bot transaction log (date/action/ticker/qty/price/value) → U3, U4
- R7 — merge `paper_trades` + `dca_dividend_credits` into one timeline → U3
- R8 — show recorded reason; pre-persistence trades show "—" → U1, U3, U4
- R9 — win-rate + benchmark from one shared source → U2

---

## Key Technical Decisions

- **Page lives under `/dashboard/bots`.** `src/middleware.ts` already protects
  `/dashboard/*` (redirects anonymous users to `/login` and sets
  `Astro.locals.user`), so the route inherits auth for free and the page only
  adds the owner-email check on top.
- **Owner gate by email allowlist.** Compare `Astro.locals.user.email` against an
  `ADMIN_EMAIL` env value (default the owner's address); non-matches redirect to
  `/dashboard`. No admin role/table is introduced. `App.Locals.user` must be typed
  (`src/env.d.ts`) — it's currently untyped, which is a live `tsc` error.
- **One shared stats source (R9).** Extract the pure win-rate replay + benchmark
  math into `scripts/lib/botStats.mjs` (plain JS, no deps, data in → numbers out).
  Both `scripts/scoreboard.mjs` and the new server lib import it, so the terminal
  and the page can never disagree. Plain `.mjs` is chosen because the standalone
  script runs under bare `node` and cannot import TypeScript.
- **Server assembles, page renders.** A new `src/lib/botScoreboard.ts` uses
  `createSupabaseAdmin()` (bots run under service accounts, so admin read bypasses
  RLS) + live prices to return everything the page needs: per-bot stats,
  benchmarks, equity curve points, and the merged transaction timeline. The page
  is a thin Astro server component calling it once on load.
- **Equity chart is dependency-free inline SVG.** The app ships no chart library
  and forbids external/CDN assets (PWA CSP); a small SVG sparkline over
  `balance_snapshots` matches existing self-contained styling.
- **Reason persisted forward only.** Add a nullable `reason` column to
  `paper_trades`; both bots write their existing `action.reason` string on insert.
  Historical rows stay null → render "—". No backfill (origin scope).
- **Dividend log rows synthesize their fields.** `dca_dividend_credits` has
  `user_id, edge_no, pesos` only; join `dividends` on `edge_no` for ticker + amount,
  derive qty = pesos ÷ amount, and compose a reason ("Cash dividend ₱x/sh"). No
  schema change to the credits table.

---

## Implementation Units

### U1. Persist trade reason on `paper_trades`

**Goal:** Store each bot's decision reason so the log can show it going forward.
**Requirements:** R8
**Dependencies:** none
**Files:**
- `docs/schema.sql` (add `reason text` to `paper_trades`; migration comment)
- `src/lib/autoTrade.ts` (include `reason` in the `paper_trades` insert)
- `src/lib/dcaBot.ts` (include `reason` in the `paper_trades` insert)
- live DB: `alter table paper_trades add column if not exists reason text;`
**Approach:** Both bots already build an `actions[]` entry with a `reason` string
per trade. Pass that same string into the `paper_trades` insert. The user-facing
manual paper-trade path (`src/components/paper/PaperTrading.tsx`) leaves `reason`
null — only bots populate it.
**Patterns to follow:** existing `paper_trades` inserts in `autoTrade.ts` /
`dcaBot.ts`; `add column if not exists` migration style already used for
`signal_cache.rsi14` in `docs/schema.sql`.
**Test scenarios:** Test expectation: none — additive nullable column + passing an
existing string through an insert; no behavioral branch. Verified via U3's log
output showing reasons on new trades.
**Verification:** After a bot run, new `paper_trades` rows have a non-null `reason`;
older rows remain null.

### U2. Extract shared bot-stats math

**Goal:** One source of truth for win-rate replay and benchmark returns (R9).
**Requirements:** R3, R9
**Dependencies:** none
**Files:**
- `scripts/lib/botStats.mjs` (new — pure functions)
- `scripts/scoreboard.mjs` (import from the new module; delete the inlined copies)
- `scripts/lib/botStats.test.mjs` (new) OR `src/lib/botStats.test.ts` importing the `.mjs`
**Approach:** Move these pure pieces out of `scripts/scoreboard.mjs` verbatim
(behavior-preserving): the trade-book win-rate replay (the `book`/`wins`/`closed`/
`realized` loop, lines ~59-70), the `alpha(botPnl, bench)` diff, and the
equal-weight basket return reducer. Each takes plain data and returns numbers — no
Supabase, no fetch. `scoreboard.mjs` imports them; the `.ts` server lib (U3)
imports the same file.
**Patterns to follow:** current computations in `scripts/scoreboard.mjs`.
**Test scenarios:**
- `winRateReplay`: BUY 10@100 then SELL 10@120 → 1 closed, 1 win, realized ≈ +200,
  winRate 100%.
- `winRateReplay`: BUY 10@100, BUY 10@200 (avg 150), SELL 10@120 → realized ≈ −300,
  0 wins, winRate 0%.
- `winRateReplay`: only BUYs, no sells → closed 0, winRate null.
- `alpha`: bot +5, bench +2 → +3; either null → null.
- `basketReturn`: two names +10% / −10% vs baseline → ~0%; empty baseline → null.
**Verification:** `scripts/scoreboard.mjs` output is unchanged for the same DB
state; new unit tests pass.

### U3. Server-side scoreboard assembler + transaction timeline

**Goal:** Return everything the page renders in one server call (R2, R3, R6, R7).
**Requirements:** R2, R3, R6, R7, R8
**Dependencies:** U1, U2
**Files:**
- `src/lib/botScoreboard.ts` (new)
- `src/lib/botScoreboard.test.ts` (new — for the pure merge/order helper)
**Approach:** Resolve the three bot user IDs by email (reuse the resolver pattern
in `src/lib/autoTrade.ts` / `src/lib/dcaBot.ts`). Via `createSupabaseAdmin()`
fetch per bot: holdings, cash, `balance_snapshots` (equity curve), `paper_trades`
(incl. `reason`), and for the DCA bot `dca_dividend_credits` joined to `dividends`.
Fetch live stock + crypto prices once (reuse `fetchAllQuotes` +
`fetchTopCryptoQuotes`). Compute stats with U2's `botStats.mjs`. Compute BTC + PSEi
benchmarks (move `btcReturnSince` / `stockBasketReturn` alongside U2 or call them
here). Build a per-bot transaction list: map `paper_trades` → {date, action,
ticker, qty, price, value, reason} and `dca_dividend_credits` → {date: payment/
credited, action: 'DIVIDEND', ticker, qty: pesos/amount, price: amount, value:
pesos, reason}; merge and sort newest-first via a pure exported `mergeTransactions`
helper.
**Patterns to follow:** `getBotState` / `getDcaState` (bot-id resolution, price
maps, admin fetch shape); benchmark helpers in `scripts/scoreboard.mjs`.
**Test scenarios:**
- `mergeTransactions`: given trades + dividend credits, result is one array sorted
  strictly by date descending.
- `mergeTransactions`: a dividend credit maps to action `DIVIDEND` with qty =
  pesos ÷ amount and value = pesos.
- `mergeTransactions`: a `paper_trades` row with null reason yields reason "—" (or
  null the page renders as "—" — pick one and assert it).
- `mergeTransactions`: empty inputs → empty array (no throw).
**Verification:** Calling the assembler returns three bots with non-null stat
fields and, for the DCA bot, a timeline interleaving BUY and DIVIDEND rows by date.

### U4. Owner-gated dashboard page + nav

**Goal:** Render the dashboard, sparkline, and expandable logs behind the email
gate (R1, R2, R3, R4, R5, R6, R8).
**Requirements:** R1, R2, R3, R4, R5, R6, R8
**Dependencies:** U3
**Files:**
- `src/pages/dashboard/bots.astro` (new)
- `src/env.d.ts` (type `App.Locals.user`)
- `src/components/layout/Sidebar.tsx` (add nav link, owner-only is fine to show)
- optionally `src/components/bots/BotTransactions.tsx` (expand/collapse log) +
  `src/components/bots/EquitySparkline.tsx` (inline SVG) — or inline in the page
**Approach:** Frontmatter reads `Astro.locals.user`; if its email ≠ `ADMIN_EMAIL`,
`return Astro.redirect('/dashboard')`. Call `getBotScoreboard()` and render three
stat cards (equity, return %, cash, positions, trades, win rate, realized P/L, and
`bot − benchmark` gap where a benchmark applies), each with an inline-SVG sparkline
from the equity curve. Below the cards, a per-bot transaction table (date, action,
ticker, qty, price, value, reason), collapsed by default and expanded on click —
the only interactive bit, so a small React island; the dashboard itself is static
server-rendered. No auto-refresh; page reflects data on load (R5).
**Patterns to follow:** `src/pages/dividends.astro` (server-fetch-in-frontmatter +
`DashboardLayout` + Tailwind table); `src/components/layout/Sidebar.tsx` link
shape; dark-theme table styling from the dividends page.
**Test scenarios:** Test expectation: none for the Astro page itself (no unit
harness for `.astro`); behavior is covered by U3's assembler tests and manual
verification. If the transaction island holds any pure formatting logic (peso/qty
formatting), unit-test that helper.
**Verification:** Logged in as the owner, `/dashboard/bots` shows all three bots +
benchmarks + sparklines + expandable logs; logged in as a non-owner it redirects to
`/dashboard`; logged out it redirects to `/login` (middleware). New trades show a
reason; old ones show "—".

---

## Scope Boundaries

**In scope:** read-only dashboard + transaction log for the three existing bots;
`reason` column + forward persistence; extraction of shared stats math.

**Out of scope:** any change to bot trading behavior (TASK-079/080 — deferred, to
be new bots); start/stop/reset controls; a general admin role or multi-user admin;
backfilling reasons for past trades.

### Deferred to Follow-Up Work
- Auto-refresh / live updates (R5 explicitly accepts manual refresh).
- Adding `reason` to `dca_dividend_credits` (dividend reason is synthesized for now).

---

## Risks & Dependencies

- **`.mjs` ↔ `.ts` import friction (U2/U3).** TypeScript importing a plain `.mjs`
  may need a one-line ambient declaration or `allowJs`. If it fights the build, the
  fallback is a tiny `.d.ts` beside `botStats.mjs`. Low risk; contained to U2/U3.
- **`App.Locals.user` typing.** Currently untyped (live `tsc` error). U4 fixes it;
  until then the email gate works at runtime but `tsc` flags it — augment
  `App.Locals` in `src/env.d.ts`.
- **`ADMIN_EMAIL` config.** Add to `.env.example` with the owner default; if unset,
  gate should fail closed (deny all) rather than open.

---

## Sources & Research

- `src/middleware.ts` — `/dashboard/*` protection, `locals.user` population.
- `src/lib/autoTrade.ts` (`getBotState`, `paper_trades` insert, bot-id resolver);
  `src/lib/dcaBot.ts` (`getDcaState`, dividend crediting, `dca_dividend_credits`).
- `scripts/scoreboard.mjs` — win-rate replay, `btcReturnSince`, `stockBasketReturn`,
  benchmark baseline file `data/benchmark-baseline.json`.
- `src/pages/dividends.astro` — server-fetch-in-frontmatter + table pattern to mirror.
- `docs/schema.sql` — `paper_trades` columns; `add column if not exists` migration style.
