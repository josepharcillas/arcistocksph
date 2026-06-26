// Autonomous paper-trading bot ("does the AI actually make money?").
// A dedicated bot account starts with ₱10,000 and, on each run, takes the
// advisor's own recommendations as real paper trades against its holdings +
// cash, then snapshots equity so we can chart whether the suggestions grow money.
//
// Reuses the exact same pipeline a human user gets: getOrComputeSignal (DB-cached
// AI) -> computeAdvice (risk-managed sizing) -> execute. The only difference is the
// bot executes the actions instead of just being shown them.
//
// Universe = the whole PSE (every ticker phisix returns a live price for). Because
// computing an AI signal for ~385 stocks at once would blow the AI rate limit, each
// run always re-checks what the bot HOLDS (so exits/trims fire) plus a rotating
// BATCH of new candidates lacking a fresh cached signal. The 4h signal_cache means
// coverage of the market accumulates across runs.

import { createSupabaseAdmin } from './supabase-admin';
import { fetchAllQuotes } from './market';
import { getOrComputeSignal } from './signals';
import { computeAdvice, DEFAULT_ADVISOR_CONFIG, type AdvisorPosition } from './advisor';

const BOT_EMAIL = process.env.BOT_EMAIL ?? 'bot@arcistocks.local';
export const STARTING_CASH = 10000;
const FRESH_MS = 4 * 60 * 60 * 1000; // mirrors signal_cache TTL

// Capital-protection risk config (override via env). Defensive by design: cap each
// position, risk little per trade, auto stop-loss + take-profit, and only act on
// higher-conviction BUYs. Goal: limit downside, lock gains — not chase max return.
export const BOT_CONFIG = {
  maxWeightPct: Number(process.env.BOT_MAX_WEIGHT_PCT ?? 15),     // most of equity in one stock
  riskPerTradePct: Number(process.env.BOT_RISK_PCT ?? 1),         // % of equity risked to the stop per trade
  stopLossPct: Number(process.env.BOT_STOP_LOSS_PCT ?? -8),       // auto-exit if a holding falls this % vs cost
  takeProfitPct: Number(process.env.BOT_TAKE_PROFIT_PCT ?? 20),   // auto-exit if a holding rises this % vs cost
  minBuyConfidence: (process.env.BOT_MIN_CONFIDENCE ?? 'MEDIUM').toUpperCase(), // skip weaker BUYs
};

const confValue = (c?: string | null): number => (c === 'HIGH' ? 3 : c === 'MEDIUM' ? 2 : c === 'LOW' ? 1 : 0);
const meetsMinConfidence = (c?: string | null): boolean => confValue(c) >= confValue(BOT_CONFIG.minBuyConfidence);

export interface AutoTradeResult {
  ok: boolean;
  ranAt: string;
  botUserId: string;
  universe: number;        // # of stocks with a live price
  signalsComputed: number; // # of fresh AI signals computed this run
  buyCandidates: number;   // # of stocks carrying a BUY signal the advisor could pick from
  cashBefore: number;
  cashAfter: number;
  equity: number;
  pnlPct: number;          // vs the ₱10,000 baseline
  actions: { kind: string; ticker?: string; shares?: number; pesos?: number; reason: string }[];
  holdings: { ticker: string; qty: number; avgCost: number; price: number; value: number }[];
  config: typeof BOT_CONFIG;
}

export interface AutoTradeOptions {
  batchSize?: number; // # of new universe tickers to compute signals for this run
}

const today = () => new Date().toISOString().slice(0, 10);

async function resolveBotUserId(admin: ReturnType<typeof createSupabaseAdmin>): Promise<string> {
  // Paginate auth users to find the bot by email.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const u = data?.users?.find((x) => x.email === BOT_EMAIL);
    if (u) return u.id;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  throw new Error(`Bot user ${BOT_EMAIL} not found — run: node scripts/seed-bot.mjs`);
}

async function logTrade(
  admin: ReturnType<typeof createSupabaseAdmin>,
  userId: string, ticker: string, action: 'BUY' | 'SELL', qty: number, price: number, name?: string,
) {
  await admin.from('paper_trades').insert({
    user_id: userId, ticker, company_name: name ?? ticker, action, qty, price,
  }).then(({ error }) => { if (error) console.warn('[auto-trade] trade log failed', error.message); });
}

export async function runAutoTrade(opts: AutoTradeOptions = {}): Promise<AutoTradeResult> {
  const batchSize = opts.batchSize ?? Number(process.env.AUTOTRADE_BATCH ?? 25);
  const admin = createSupabaseAdmin();
  const botId = await resolveBotUserId(admin);

  // --- Load bot state ---
  const [{ data: holdingsRows }, { data: cashRow }] = await Promise.all([
    admin.from('holdings').select('ticker, qty, buy_price, company_name').eq('user_id', botId),
    admin.from('portfolio_cash').select('cash').eq('user_id', botId).maybeSingle(),
  ]);
  const holdings = (holdingsRows ?? []).map((h: any) => ({
    ticker: h.ticker as string, qty: Number(h.qty), buy_price: Number(h.buy_price),
    company_name: (h.company_name as string) ?? h.ticker,
  }));
  let cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
  const cashBefore = cash;

  // --- Whole-market live quotes (one call) ---
  const quotes = await fetchAllQuotes();
  const universe = [...quotes.values()].filter((q) => q.price > 0);
  const price = (t: string) => quotes.get(t)?.price ?? 0;

  const held = new Set(holdings.map((h) => h.ticker));

  // --- Decide which tickers to (re)compute signals for ---
  const { data: cacheRows } = await admin
    .from('signal_cache').select('ticker, verdict, confidence, stop_loss, computed_at');
  const cacheMap = new Map<string, any>((cacheRows ?? []).map((r: any) => [r.ticker, r]));
  const isFresh = (t: string) => {
    const c = cacheMap.get(t);
    return c && Date.now() - new Date(c.computed_at).getTime() < FRESH_MS;
  };

  const newCandidates = universe
    .map((q) => q.symbol)
    .filter((t) => !held.has(t) && !isFresh(t))
    .slice(0, batchSize);
  const toCompute = [...new Set([...held, ...newCandidates])];

  let signalsComputed = 0;
  for (const t of toCompute) {
    try {
      const r = await getOrComputeSignal(t, quotes.get(t)?.name);
      if (!r.cached) signalsComputed++;
      cacheMap.set(t, { ticker: t, verdict: r.verdict, confidence: r.confidence, stop_loss: r.stopLoss, computed_at: r.analyzedAt });
    } catch (err) {
      console.warn('[auto-trade] signal failed for', t, err instanceof Error ? err.message : err);
    }
  }

  const byTicker = new Map(holdings.map((h) => [h.ticker, { ...h }]));

  // --- SELL pass: protect capital + follow ArciStocks. Fully exit a holding if
  //     ANY of these is true: the app rates it SELL, it hit the stop-loss, or it
  //     hit the take-profit. Stop-loss caps losses; take-profit locks gains. ---
  const sellActions: AutoTradeResult['actions'] = [];
  for (const h of holdings) {
    const sig = cacheMap.get(h.ticker);
    const p = price(h.ticker) || h.buy_price;
    const plPct = h.buy_price > 0 ? ((p - h.buy_price) / h.buy_price) * 100 : 0;
    let why: string | null = null;
    if (sig?.verdict === 'SELL') why = 'SELL signal';
    else if (plPct <= BOT_CONFIG.stopLossPct) why = `stop-loss (${BOT_CONFIG.stopLossPct}%)`;
    else if (plPct >= BOT_CONFIG.takeProfitPct) why = `take-profit (+${BOT_CONFIG.takeProfitPct}%)`;
    if (!why) continue;
    const proceeds = h.qty * p;
    cash += proceeds;
    await admin.from('holdings').delete().eq('user_id', botId).eq('ticker', h.ticker);
    byTicker.delete(h.ticker);
    await logTrade(admin, botId, h.ticker, 'SELL', h.qty, p, h.company_name);
    sellActions.push({
      kind: 'EXIT', ticker: h.ticker, shares: h.qty, pesos: proceeds,
      reason: `${why} — sold all ${h.qty} share(s) at ₱${p.toFixed(2)} (${plPct >= 0 ? '+' : ''}${plPct.toFixed(0)}% vs cost).`,
    });
  }

  // --- BUY/TRIM pass: feed surviving holdings + every BUY-signalled stock to the
  //     risk-managed advisor, which sizes new positions and trims over-concentration. ---
  const positions: AdvisorPosition[] = [];
  for (const h of byTicker.values()) {
    const s = cacheMap.get(h.ticker);
    // Only let the advisor ADD to a holding on a BUY that clears the confidence
    // floor; otherwise treat as HOLD so we don't average up on weak conviction.
    const verdict = s?.verdict === 'BUY' && !meetsMinConfidence(s?.confidence) ? 'HOLD' : (s?.verdict ?? null);
    positions.push({
      ticker: h.ticker, shares: h.qty, avgCost: h.buy_price, price: price(h.ticker) || h.buy_price,
      verdict, confidence: s?.confidence ?? null, stopLoss: s?.stop_loss ?? null,
    });
  }
  let buyCandidates = 0;
  for (const q of universe) {
    if (byTicker.has(q.symbol)) continue;
    const s = cacheMap.get(q.symbol);
    // New positions: only higher-conviction BUYs (skip LOW confidence).
    if (s?.verdict === 'BUY' && meetsMinConfidence(s?.confidence) && q.price > 0) {
      buyCandidates++;
      positions.push({ ticker: q.symbol, shares: 0, avgCost: 0, price: q.price, verdict: 'BUY', confidence: s.confidence ?? null, stopLoss: s.stop_loss ?? null });
    }
  }

  const advice = computeAdvice(positions, cash, {
    ...DEFAULT_ADVISOR_CONFIG, sizing: 'risk',
    maxWeightPct: BOT_CONFIG.maxWeightPct, riskPerTradePct: BOT_CONFIG.riskPerTradePct,
  });

  // Execute the advisor's BUY + TRIM actions. (SELLs already handled above; the
  // surviving positions carry only HOLD/BUY verdicts, so no EXIT is produced here.)
  for (const a of advice.actions) {
    if (a.kind === 'BUY' && a.ticker && a.shares) {
      const p = price(a.ticker);
      const cost = a.shares * p;
      if (p <= 0 || cost > cash + 1e-6) continue;
      cash -= cost;
      const ex = byTicker.get(a.ticker);
      if (ex) {
        const newQty = ex.qty + a.shares;
        const newAvg = (ex.qty * ex.buy_price + cost) / newQty;
        await admin.from('holdings').update({ qty: newQty, buy_price: newAvg }).eq('user_id', botId).eq('ticker', a.ticker);
        ex.qty = newQty; ex.buy_price = newAvg;
      } else {
        const name = quotes.get(a.ticker)?.name ?? a.ticker;
        await admin.from('holdings').insert({ user_id: botId, ticker: a.ticker, company_name: name, qty: a.shares, buy_price: p, buy_date: today() });
        byTicker.set(a.ticker, { ticker: a.ticker, qty: a.shares, buy_price: p, company_name: name });
      }
      await logTrade(admin, botId, a.ticker, 'BUY', a.shares, p, quotes.get(a.ticker)?.name);
    } else if (a.kind === 'TRIM' && a.ticker && a.shares) {
      const ex = byTicker.get(a.ticker);
      if (!ex) continue;
      const p = price(a.ticker) || ex.buy_price;
      cash += a.shares * p;
      const newQty = ex.qty - a.shares;
      if (newQty <= 0.0001) {
        await admin.from('holdings').delete().eq('user_id', botId).eq('ticker', a.ticker);
        byTicker.delete(a.ticker);
      } else {
        await admin.from('holdings').update({ qty: newQty }).eq('user_id', botId).eq('ticker', a.ticker);
        ex.qty = newQty;
      }
      await logTrade(admin, botId, a.ticker, 'SELL', a.shares, p, ex.company_name);
    }
  }

  // All actions taken this run = signal-driven SELLs + advisor BUY/TRIM/HOLD.
  const actions = [...sellActions, ...advice.actions.filter((a) => a.kind !== 'EXIT')];

  // --- Persist cash, snapshot equity ---
  await admin.from('portfolio_cash').upsert({ user_id: botId, cash, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

  const finalHoldings = [...byTicker.values()].map((h) => {
    const p = price(h.ticker) || h.buy_price;
    return { ticker: h.ticker, qty: h.qty, avgCost: h.buy_price, price: p, value: h.qty * p };
  });
  const equity = cash + finalHoldings.reduce((s, h) => s + h.value, 0);
  await admin.from('balance_snapshots').upsert(
    { user_id: botId, snapshot_date: today(), total_value: equity },
    { onConflict: 'user_id,snapshot_date' },
  );

  return {
    ok: true, ranAt: new Date().toISOString(), botUserId: botId,
    universe: universe.length, signalsComputed, buyCandidates,
    cashBefore, cashAfter: cash, equity,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    actions, holdings: finalHoldings, config: BOT_CONFIG,
  };
}

// Read-only snapshot of the bot's current state + equity curve (no trading).
export async function getBotState() {
  const admin = createSupabaseAdmin();
  const botId = await resolveBotUserId(admin);
  const [{ data: holdings }, { data: cashRow }, { data: snaps }, { data: trades }] = await Promise.all([
    admin.from('holdings').select('ticker, qty, buy_price, company_name').eq('user_id', botId),
    admin.from('portfolio_cash').select('cash').eq('user_id', botId).maybeSingle(),
    admin.from('balance_snapshots').select('snapshot_date, total_value').eq('user_id', botId).order('snapshot_date'),
    admin.from('paper_trades').select('ticker, action, qty, price, traded_at').eq('user_id', botId).order('traded_at', { ascending: false }).limit(50),
  ]);
  const quotes = await fetchAllQuotes().catch(() => new Map());
  const hs = (holdings ?? []).map((h: any) => {
    const p = (quotes as Map<string, any>).get(h.ticker)?.price ?? Number(h.buy_price);
    return { ticker: h.ticker, qty: Number(h.qty), avgCost: Number(h.buy_price), price: p, value: Number(h.qty) * p };
  });
  const cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
  const equity = cash + hs.reduce((s, h) => s + h.value, 0);
  return {
    botUserId: botId, cash, equity, holdings: hs,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    startingCash: STARTING_CASH,
    equityCurve: (snaps ?? []).map((s: any) => ({ date: s.snapshot_date, value: Number(s.total_value) })),
    recentTrades: trades ?? [],
  };
}
