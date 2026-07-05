// Pure bot-stats math — the single source of truth shared by the terminal
// scoreboard (scripts/scoreboard.mjs) and the /dashboard/bots page
// (src/lib/botScoreboard.ts), so the two can never disagree (plan R9).
// Plain JS with no dependencies: data in, numbers out. Kept as .mjs because the
// standalone scoreboard script runs under bare `node` and can't import TypeScript.

/** Replay a bot's trades (oldest-first) to derive realized win-rate + P/L.
 *  Each SELL closes against the running average cost of the position.
 *  trades: [{ ticker, action: 'BUY'|'SELL', qty, price }]. */
export function winRateReplay(trades) {
  const book = {};
  let wins = 0, closed = 0, realized = 0;
  for (const t of trades ?? []) {
    const b = (book[t.ticker] ??= { qty: 0, cost: 0 });
    const q = Number(t.qty), pr = Number(t.price);
    if (t.action === 'BUY') {
      b.cost += q * pr; b.qty += q;
    } else {
      const avg = b.qty > 0 ? b.cost / b.qty : pr;
      const pl = (pr - avg) * q;
      realized += pl; closed++; if (pl >= 0) wins++;
      b.qty -= q; b.cost -= avg * q;
    }
  }
  return { closed, wins, realized, winRate: closed ? (wins / closed) * 100 : null };
}

/** Bot return minus benchmark return (percentage points); null if either is null. */
export function alpha(botPnl, bench) {
  return (botPnl == null || bench == null) ? null : botPnl - bench;
}

/** Equal-weight basket % return from a baseline price map to current prices.
 *  baseline: { TICKER: priceAtBaseline }; current: a Map or plain object of
 *  TICKER -> current price. Names missing a valid current price are skipped. */
export function basketReturn(baseline, current) {
  const get = typeof current?.get === 'function' ? (t) => current.get(t) : (t) => current?.[t];
  const rets = [];
  for (const [t, base] of Object.entries(baseline ?? {})) {
    const cur = get(t);
    if (cur > 0 && base > 0) rets.push(cur / base - 1);
  }
  return rets.length ? (rets.reduce((s, x) => s + x, 0) / rets.length) * 100 : null;
}
