// The "investor bot" — pure peso-cost averaging, the evidence-backed slow strategy
// (see the 2026-07-02 research: DCA into dividend blue chips + BTC, almost never
// sell, judge over years). It ignores AI signals entirely: a fixed ₱ budget on a
// fixed weekly schedule, split ~80% PSE dividend blue chips / ~20% BTC.
//
// Buy rule: each cycle, buy the most-underweight affordable name in the dividend
// universe (equal-weight building = diversification + rebalance-by-buying).
// Sell rule: never. (No dividend feed exists, so dividend income is NOT modeled —
// this bot's results understate the real strategy, which earns 5-13% yields. Noted
// in the report.)

import { createSupabaseAdmin } from './supabase-admin';
import { fetchAllQuotes } from './market';
import { fetchTopCryptoQuotes } from './market/crypto';
import { STARTING_CASH, STOCK_FEES, CRYPTO_FEES } from './autoTrade';

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

async function resolveDcaUserId(admin: ReturnType<typeof createSupabaseAdmin>): Promise<string> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const u = data?.users?.find((x) => x.email === DCA_BOT_EMAIL);
    if (u) return u.id;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  throw new Error(`DCA bot user ${DCA_BOT_EMAIL} not found — run: node scripts/seed-bot.mjs`);
}

export async function runDcaBot(): Promise<DcaRunResult> {
  const admin = createSupabaseAdmin();
  const botId = await resolveDcaUserId(admin);

  const [{ data: holdingsRows }, { data: cashRow }, stockQuotes, cryptoQuotes] = await Promise.all([
    admin.from('holdings').select('ticker, qty, buy_price, company_name').eq('user_id', botId),
    admin.from('portfolio_cash').select('cash').eq('user_id', botId).maybeSingle(),
    fetchAllQuotes(),
    fetchTopCryptoQuotes(10),
  ]);
  const holdings = new Map(
    ((holdingsRows ?? []) as any[]).map((h) => [h.ticker as string, {
      ticker: h.ticker as string, qty: Number(h.qty), buy_price: Number(h.buy_price),
      company_name: (h.company_name as string) ?? h.ticker,
    }]),
  );
  let cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
  const cashBefore = cash;

  const price = (t: string): number =>
    t.startsWith('X:') ? (cryptoQuotes.get(t)?.price ?? 0) : (stockQuotes.get(t)?.price ?? 0);

  const actions: DcaRunResult['actions'] = [];

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
      await admin.from('holdings').update({ qty: newQty, buy_price: newAvg }).eq('user_id', botId).eq('ticker', ticker);
      ex.qty = newQty; ex.buy_price = newAvg;
    } else {
      await admin.from('holdings').insert({ user_id: botId, ticker, company_name: name, qty, buy_price: effPrice, buy_date: today() });
      holdings.set(ticker, { ticker, qty, buy_price: effPrice, company_name: name });
    }
    await admin.from('paper_trades').insert({ user_id: botId, ticker, company_name: name, action: 'BUY', qty, price: effPrice })
      .then(({ error }) => { if (error) console.warn('[dca-bot] trade log failed', error.message); });
    actions.push({
      kind: 'BUY', ticker: display(ticker), shares: qty, pesos: cost,
      reason: `Scheduled DCA — ${fractional ? qty.toFixed(8) : qty} unit(s) of ${display(ticker)} for ₱${cost.toFixed(2)}.`,
    });
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
  await admin.from('portfolio_cash').upsert({ user_id: botId, cash, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  const finalHoldings = [...holdings.values()].map((h) => {
    const p = price(h.ticker) || h.buy_price;
    return { ticker: display(h.ticker), qty: h.qty, avgCost: h.buy_price, price: p, value: h.qty * p };
  });
  const equity = cash + finalHoldings.reduce((s, h) => s + h.value, 0);
  await admin.from('balance_snapshots').upsert(
    { user_id: botId, snapshot_date: today(), total_value: equity },
    { onConflict: 'user_id,snapshot_date' },
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
  const admin = createSupabaseAdmin();
  const botId = await resolveDcaUserId(admin);
  const [{ data: holdings }, { data: cashRow }, { data: snaps }, { data: trades }, stockQuotes, cryptoQuotes] = await Promise.all([
    admin.from('holdings').select('ticker, qty, buy_price, company_name').eq('user_id', botId),
    admin.from('portfolio_cash').select('cash').eq('user_id', botId).maybeSingle(),
    admin.from('balance_snapshots').select('snapshot_date, total_value').eq('user_id', botId).order('snapshot_date'),
    admin.from('paper_trades').select('ticker, action, qty, price, traded_at').eq('user_id', botId).order('traded_at', { ascending: false }).limit(50),
    fetchAllQuotes().catch(() => new Map()),
    fetchTopCryptoQuotes(10).catch(() => new Map()),
  ]);
  const price = (t: string): number =>
    t.startsWith('X:') ? ((cryptoQuotes as Map<string, any>).get(t)?.price ?? 0) : ((stockQuotes as Map<string, any>).get(t)?.price ?? 0);
  const hs = (holdings ?? []).map((h: any) => {
    const p = price(h.ticker) || Number(h.buy_price);
    return { ticker: display(h.ticker), qty: Number(h.qty), avgCost: Number(h.buy_price), price: p, value: Number(h.qty) * p };
  });
  const cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
  const equity = cash + hs.reduce((s, h) => s + h.value, 0);
  return {
    assetClass: 'dca', botUserId: botId, cash, equity, holdings: hs,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    startingCash: STARTING_CASH, config: DCA_CONFIG,
    equityCurve: (snaps ?? []).map((s: any) => ({ date: s.snapshot_date, value: Number(s.total_value) })),
    recentTrades: (trades ?? []).map((t: any) => ({ ...t, ticker: display(t.ticker) })),
  };
}
