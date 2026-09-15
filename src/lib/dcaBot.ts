// The "investor bot" — pure peso-cost averaging, the evidence-backed slow strategy
// (see the 2026-07-02 research: DCA into dividend blue chips + BTC, almost never
// sell, judge over years). It ignores AI signals entirely: a fixed ₱ budget on a
// fixed weekly schedule, split ~80% PSE dividend blue chips / ~20% BTC.
//
// Buy rule: each cycle, buy the most-underweight affordable name in the dividend
// universe (equal-weight building = diversification + rebalance-by-buying).
// Sell rule: never. Dividend income IS modeled: paid dividends on held stocks
// are credited to cash from the scraped PSE Edge `dividends` table (idempotent
// via dca_dividend_credits).

import { query } from './db';
import { getOrCreateUser } from './repo';
import { fetchAllQuotes } from './market';
import { fetchTopCryptoQuotes } from './market/crypto';
import { STARTING_CASH, STOCK_FEES, CRYPTO_FEES } from './autoTrade';
import { dedupeDividendEvents } from './dividendLogic';

const DCA_BOT_EMAIL = process.env.DCA_BOT_EMAIL ?? 'dca-bot@arcistocks.local';

// Consistent PH dividend payers per the research: telcos, banks, power, REITs.
// (Deliberately skips max-yield cyclicals like SCC — the sources warn against
// chasing the highest yield.)
const DIVIDEND_UNIVERSE = ['TEL', 'GLO', 'BDO', 'BPI', 'MBT', 'AP', 'MER', 'AREIT', 'RCR'];
const BTC_TICKER = 'X:BTC';

export const DCA_CONFIG = {
  weeklyStockBudget: Number(process.env.DCA_WEEKLY_STOCK ?? 400), // ₱/week into blue chips
  weeklyBtcBudget: Number(process.env.DCA_WEEKLY_BTC ?? 100),     // ₱/week into BTC (~20% satellite)
};

export interface DcaRunResult {
  ok: boolean;
  ranAt: string;
  botUserId: string;
  cashBefore: number;
  cashAfter: number;
  equity: number;
  pnlPct: number;
  actions: { kind: string; ticker?: string; shares?: number; pesos?: number; reason: string }[];
  holdings: { ticker: string; qty: number; avgCost: number; price: number; value: number }[];
}

const today = () => new Date().toISOString().slice(0, 10);
const display = (t: string) => t.replace(/^X:/, '');

// Serialises runs across the whole process. The bot's cash update is a
// read-modify-write (read below, written at the end), so two concurrent runs
// each read the same starting cash and the last write wins — silently erasing
// the other's spending. Keyed on globalThis so a dev-server module reload can't
// hand out a second, independent lock.
const LOCK_KEY = Symbol.for('arcistocks.dcaBot.lock');
const lockHost = globalThis as unknown as { [LOCK_KEY]?: Promise<unknown> };

export function runDcaBot(): Promise<DcaRunResult> {
  const prior = lockHost[LOCK_KEY] ?? Promise.resolve();
  const next = prior.then(runDcaBotUnlocked, runDcaBotUnlocked);
  // Keep the chain alive even if this run rejects, so the lock never wedges.
  lockHost[LOCK_KEY] = next.catch(() => undefined);
  return next;
}

async function runDcaBotUnlocked(): Promise<DcaRunResult> {
  const botId = (await getOrCreateUser(DCA_BOT_EMAIL)).id;

  const [holdingsRows, cashRow, stockQuotes, cryptoQuotes] = await Promise.all([
    query<any>(`select ticker, qty, buy_price, buy_date, company_name from holdings where user_id = $1`, [botId]),
    query<{ cash: number }>(`select cash from portfolio_cash where user_id = $1`, [botId]).then((r) => r[0] ?? null),
    fetchAllQuotes(),
    fetchTopCryptoQuotes(10),
  ]);
  const holdings = new Map(
    holdingsRows.map((h: any) => [h.ticker as string, {
      ticker: h.ticker as string, qty: Number(h.qty), buy_price: Number(h.buy_price),
      buy_date: (h.buy_date as string | null) ?? null,
      company_name: (h.company_name as string) ?? h.ticker,
    }]),
  );
  let cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
  const cashBefore = cash;

  const price = (t: string): number =>
    t.startsWith('X:') ? (cryptoQuotes.get(t)?.price ?? 0) : (stockQuotes.get(t)?.price ?? 0);

  const actions: DcaRunResult['actions'] = [];

  // --- Dividend income: credit cash for dividends PAID on held stocks (from the
  // scraped `dividends` table). This is the half of dividend investing the sim
  // used to ignore. Idempotent via dca_dividend_credits (one credit per
  // disclosure). Approximation: uses today's qty, and requires the first buy to
  // predate the record date — good enough for a paper forward-test.
  const heldStocks = [...holdings.keys()].filter((t) => !t.startsWith('X:'));
  if (heldStocks.length > 0) {
    const since = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
    const paidRaw = await query<any>(
      `select edge_no, ticker, amount, security_type, record_date, payment_date, announced_at
         from dividends
        where ticker = any($1::text[]) and security_type = 'COMMON'
          and payment_date <= $2 and payment_date >= $3`,
      [heldStocks, today(), since]
    );
    // Same dividend can be filed twice — dedupe per event so we credit once.
    const byT = new Map<string, any[]>();
    for (const r of paidRaw) {
      const a = byT.get(r.ticker) ?? []; a.push({ ...r, edgeNo: r.edge_no, securityType: r.security_type, recordDate: r.record_date, announcedAt: r.announced_at }); byT.set(r.ticker, a);
    }
    const paid = [...byT.values()].flatMap((rows) => dedupeDividendEvents(rows));
    for (const d of paid as any[]) {
      const h = holdings.get(d.ticker);
      if (!h) continue;
      if (d.record_date && h.buy_date && h.buy_date > d.record_date) continue; // bought too late for this payout
      const pesos = h.qty * Number(d.amount);
      if (!(pesos > 0)) continue;
      try {
        await query(
          `insert into dca_dividend_credits (user_id, edge_no, pesos) values ($1, $2, $3)`,
          [botId, d.edge_no, pesos]
        );
      } catch (err: any) {
        if (err?.code === '23505') continue; // duplicate key = already credited on an earlier run
        throw err;
      }
      cash += pesos;
      actions.push({
        kind: 'DIVIDEND', ticker: d.ticker, pesos,
        reason: `Cash dividend received: ₱${Number(d.amount).toFixed(4)}/sh × ${h.qty} sh = ₱${pesos.toFixed(2)}.`,
      });
    }
  }

  async function buy(ticker: string, budget: number, fees: { buyPct: number }, fractional: boolean, name: string) {
    const mkt = price(ticker);
    if (mkt <= 0 || budget <= 0) return;
    const effPrice = mkt * (1 + fees.buyPct);
    const qty = fractional ? budget / effPrice : Math.floor(budget / effPrice);
    if (!(qty > 0)) return; // too expensive this cycle — budget rolls over in cash
    const cost = qty * effPrice;
    cash -= cost;
    const ex = holdings.get(ticker);
    if (ex) {
      const newQty = ex.qty + qty;
      const newAvg = (ex.qty * ex.buy_price + cost) / newQty;
      await query(`update holdings set qty = $1, buy_price = $2 where user_id = $3 and ticker = $4`, [newQty, newAvg, botId, ticker]);
      ex.qty = newQty; ex.buy_price = newAvg;
    } else {
      await query(
        `insert into holdings (user_id, ticker, company_name, qty, buy_price, buy_date) values ($1,$2,$3,$4,$5,$6)`,
        [botId, ticker, name, qty, effPrice, today()]
      );
      holdings.set(ticker, { ticker, qty, buy_price: effPrice, buy_date: today(), company_name: name });
    }
    const reason = `Scheduled DCA — ${fractional ? qty.toFixed(8) : qty} unit(s) of ${display(ticker)} for ₱${cost.toFixed(2)}.`;
    await query(
      `insert into paper_trades (user_id, ticker, company_name, action, qty, price, reason) values ($1,$2,$3,'BUY',$4,$5,$6)`,
      [botId, ticker, name, qty, effPrice, reason]
    ).catch((err) => console.warn('[dca-bot] trade log failed', err instanceof Error ? err.message : err));
    actions.push({ kind: 'BUY', ticker: display(ticker), shares: qty, pesos: cost, reason });
  }

  // --- Stock leg: most-underweight affordable dividend name (equal-weight build) ---
  const stockBudget = Math.min(DCA_CONFIG.weeklyStockBudget, cash);
  const ranked = DIVIDEND_UNIVERSE
    .map((t) => ({ t, p: price(t), value: (holdings.get(t)?.qty ?? 0) * (price(t) || holdings.get(t)?.buy_price || 0) }))
    .filter((x) => x.p > 0 && x.p * (1 + STOCK_FEES.buyPct) <= stockBudget) // affordable: ≥1 share in budget
    .sort((a, b) => a.value - b.value);
  if (ranked.length > 0) {
    const pick = ranked[0];
    await buy(pick.t, stockBudget, STOCK_FEES, false, stockQuotes.get(pick.t)?.name ?? pick.t);
  } else {
    actions.push({ kind: 'HOLD_CASH', pesos: stockBudget, reason: 'No dividend blue chip affordable within this cycle\'s budget — rolls over.' });
  }

  // --- BTC leg: fixed fractional buy, every cycle, no timing ---
  const btcBudget = Math.min(DCA_CONFIG.weeklyBtcBudget, cash);
  await buy(BTC_TICKER, btcBudget, CRYPTO_FEES, true, 'Bitcoin');

  // --- Persist cash + snapshot equity ---
  await query(
    `insert into portfolio_cash (user_id, cash, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set cash = excluded.cash, updated_at = now()`,
    [botId, cash]
  );
  const finalHoldings = [...holdings.values()].map((h) => {
    const p = price(h.ticker) || h.buy_price;
    return { ticker: display(h.ticker), qty: h.qty, avgCost: h.buy_price, price: p, value: h.qty * p };
  });
  const equity = cash + finalHoldings.reduce((s, h) => s + h.value, 0);
  await query(
    `insert into balance_snapshots (user_id, snapshot_date, total_value) values ($1, $2, $3)
       on conflict (user_id, snapshot_date) do update set total_value = excluded.total_value`,
    [botId, today(), equity]
  );

  return {
    ok: true, ranAt: new Date().toISOString(), botUserId: botId,
    cashBefore, cashAfter: cash, equity,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    actions, holdings: finalHoldings,
  };
}

// Read-only state (no buying).
export async function getDcaState() {
  const botId = (await getOrCreateUser(DCA_BOT_EMAIL)).id;
  const [holdings, cashRow, snaps, trades, stockQuotes, cryptoQuotes] = await Promise.all([
    query<any>(`select ticker, qty, buy_price, company_name from holdings where user_id = $1`, [botId]),
    query<{ cash: number }>(`select cash from portfolio_cash where user_id = $1`, [botId]).then((r) => r[0] ?? null),
    query<any>(`select snapshot_date, total_value from balance_snapshots where user_id = $1 order by snapshot_date`, [botId]),
    query<any>(`select ticker, action, qty, price, traded_at from paper_trades where user_id = $1 order by traded_at desc limit 50`, [botId]),
    fetchAllQuotes().catch(() => new Map()),
    fetchTopCryptoQuotes(10).catch(() => new Map()),
  ]);
  const price = (t: string): number =>
    t.startsWith('X:') ? ((cryptoQuotes as Map<string, any>).get(t)?.price ?? 0) : ((stockQuotes as Map<string, any>).get(t)?.price ?? 0);
  const hs = holdings.map((h: any) => {
    const p = price(h.ticker) || Number(h.buy_price);
    return { ticker: display(h.ticker), qty: Number(h.qty), avgCost: Number(h.buy_price), price: p, value: Number(h.qty) * p };
  });
  const cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
  const equity = cash + hs.reduce((s, h) => s + h.value, 0);
  return {
    assetClass: 'dca', botUserId: botId, cash, equity, holdings: hs,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    startingCash: STARTING_CASH, config: DCA_CONFIG,
    equityCurve: snaps.map((s: any) => ({ date: s.snapshot_date, value: Number(s.total_value) })),
    recentTrades: trades.map((t: any) => ({ ...t, ticker: display(t.ticker) })),
  };
}
