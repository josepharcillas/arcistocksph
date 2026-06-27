// Autonomous paper-trading bots ("does the AI actually make money?").
// A dedicated bot account starts with ₱10,000 and, on each run, takes the
// advisor's own recommendations as real paper trades against its holdings +
// cash, then snapshots equity so we can chart whether the suggestions grow money.
//
// Two asset classes, each with its OWN ₱10k account (compare stocks vs crypto):
//   - stock : whole PSE via phisix quotes + PSE Edge history (market hours)
//   - crypto: top-N coins via CoinGecko, priced in PHP (24/7)
// Crypto tickers are namespaced ("X:BTC") so signals/holdings never clash with
// PSE symbols. Reuses the same pipeline a human gets: signal -> computeAdvice ->
// execute. Each run always re-checks HOLDINGS (so exits/trims fire) plus a
// rotating BATCH of new candidates lacking a fresh cached signal (4h cache).

import { createSupabaseAdmin } from './supabase-admin';
import { fetchAllQuotes } from './market';
import { fetchTopCryptoQuotes, CRYPTO_PREFIX } from './market/crypto';
import { getOrComputeSignal } from './signals';
import { getOrComputeCryptoSignal } from './cryptoSignals';
import { computeAdvice, DEFAULT_ADVISOR_CONFIG, type AdvisorPosition } from './advisor';

export type AssetClass = 'stock' | 'crypto';

export const STARTING_CASH = 10000;
const FRESH_MS = 4 * 60 * 60 * 1000; // mirrors signal_cache TTL

const STOCK_BOT_EMAIL = process.env.BOT_EMAIL ?? 'bot@arcistocks.local';
const CRYPTO_BOT_EMAIL = process.env.CRYPTO_BOT_EMAIL ?? 'crypto-bot@arcistocks.local';

// Capital-protection risk config per asset (override via env). Defensive: cap each
// position, risk little per trade, auto stop-loss + take-profit, strongest BUYs only.
// Crypto runs wider stops/targets because it's far more volatile than PSE stocks.
export const BOT_CONFIG = {
  maxWeightPct: Number(process.env.BOT_MAX_WEIGHT_PCT ?? 15),
  riskPerTradePct: Number(process.env.BOT_RISK_PCT ?? 1),
  stopLossPct: Number(process.env.BOT_STOP_LOSS_PCT ?? -8),
  takeProfitPct: Number(process.env.BOT_TAKE_PROFIT_PCT ?? 20),
  minBuyConfidence: (process.env.BOT_MIN_CONFIDENCE ?? 'HIGH').toUpperCase(),
};
export const CRYPTO_CONFIG = {
  maxWeightPct: Number(process.env.BOT_CRYPTO_MAX_WEIGHT_PCT ?? 20),
  riskPerTradePct: Number(process.env.BOT_CRYPTO_RISK_PCT ?? 1),
  stopLossPct: Number(process.env.BOT_CRYPTO_STOP_LOSS_PCT ?? -15),
  takeProfitPct: Number(process.env.BOT_CRYPTO_TAKE_PROFIT_PCT ?? 35),
  // MEDIUM (not HIGH): the AI almost never rates crypto HIGH, so HIGH-only left the
  // bot inert (0 trades). MEDIUM lets it actually participate; the -15% stop still caps risk.
  minBuyConfidence: (process.env.BOT_CRYPTO_MIN_CONFIDENCE ?? 'MEDIUM').toUpperCase(),
};

const confValue = (c?: string | null): number => (c === 'HIGH' ? 3 : c === 'MEDIUM' ? 2 : c === 'LOW' ? 1 : 0);

export interface AutoTradeResult {
  ok: boolean;
  assetClass: AssetClass;
  ranAt: string;
  botUserId: string;
  universe: number;
  signalsComputed: number;
  buyCandidates: number;
  cashBefore: number;
  cashAfter: number;
  equity: number;
  pnlPct: number;
  actions: { kind: string; ticker?: string; shares?: number; pesos?: number; reason: string }[];
  holdings: { ticker: string; qty: number; avgCost: number; price: number; value: number }[];
  config: typeof BOT_CONFIG;
}

export interface AutoTradeOptions {
  assetClass?: AssetClass;
  batchSize?: number;
}

interface UniverseEntry { ticker: string; price: number; name: string; symbol: string; id?: string }

const today = () => new Date().toISOString().slice(0, 10);
const display = (t: string) => t.replace(new RegExp('^' + CRYPTO_PREFIX), '');

async function resolveBotUserId(admin: ReturnType<typeof createSupabaseAdmin>, email: string): Promise<string> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const u = data?.users?.find((x) => x.email === email);
    if (u) return u.id;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  throw new Error(`Bot user ${email} not found — run: node scripts/seed-bot.mjs`);
}

async function loadUniverse(assetClass: AssetClass): Promise<UniverseEntry[]> {
  if (assetClass === 'crypto') {
    const m = await fetchTopCryptoQuotes(Number(process.env.CRYPTO_UNIVERSE ?? 30));
    return [...m.values()].map((c) => ({ ticker: c.ticker, price: c.price, name: c.name, symbol: c.symbol, id: c.id }));
  }
  const m = await fetchAllQuotes();
  return [...m.values()].filter((q) => q.price > 0).map((q) => ({ ticker: q.symbol, price: q.price, name: q.name, symbol: q.symbol }));
}

async function computeSignalFor(assetClass: AssetClass, e: UniverseEntry) {
  if (assetClass === 'crypto') return getOrComputeCryptoSignal(e.ticker, e.id ?? e.symbol, e.symbol, e.name);
  return getOrComputeSignal(e.ticker, e.name);
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
  const assetClass: AssetClass = opts.assetClass ?? 'stock';
  const config = assetClass === 'crypto' ? CRYPTO_CONFIG : BOT_CONFIG;
  const email = assetClass === 'crypto' ? CRYPTO_BOT_EMAIL : STOCK_BOT_EMAIL;
  const meetsMinConfidence = (c?: string | null) => confValue(c) >= confValue(config.minBuyConfidence);
  const defaultBatch = assetClass === 'crypto' ? 6 : 25;
  const batchSize = opts.batchSize ?? Number(process.env.AUTOTRADE_BATCH ?? defaultBatch);

  const admin = createSupabaseAdmin();
  const botId = await resolveBotUserId(admin, email);

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

  // --- Live universe (one bulk call) ---
  const universe = await loadUniverse(assetClass);
  const uni = new Map(universe.map((e) => [e.ticker, e]));
  const price = (t: string) => uni.get(t)?.price ?? 0;
  const held = new Set(holdings.map((h) => h.ticker));

  // --- Decide which tickers to (re)compute signals for: all held + rotating batch ---
  const { data: cacheRows } = await admin
    .from('signal_cache').select('ticker, verdict, confidence, stop_loss, computed_at');
  const cacheMap = new Map<string, any>((cacheRows ?? []).map((r: any) => [r.ticker, r]));
  const isFresh = (t: string) => {
    const c = cacheMap.get(t);
    return c && Date.now() - new Date(c.computed_at).getTime() < FRESH_MS;
  };

  const newCandidates = universe
    .map((e) => e.ticker)
    .filter((t) => !held.has(t) && !isFresh(t))
    .slice(0, batchSize);
  const toCompute = [...new Set([...held, ...newCandidates])];

  let signalsComputed = 0;
  for (const t of toCompute) {
    const e = uni.get(t);
    if (!e) continue; // held item no longer in the universe (e.g. fell out of top-N) — keep cached
    try {
      const r = await computeSignalFor(assetClass, e);
      if (!r.cached) signalsComputed++;
      cacheMap.set(t, { ticker: t, verdict: r.verdict, confidence: r.confidence, stop_loss: r.stopLoss, computed_at: r.analyzedAt });
    } catch (err) {
      console.warn('[auto-trade] signal failed for', t, err instanceof Error ? err.message : err);
    }
  }

  const byTicker = new Map(holdings.map((h) => [h.ticker, { ...h }]));

  // --- SELL pass: protect capital + follow ArciStocks. Fully exit a holding if
  //     the app rates it SELL, it hit the stop-loss, or it hit the take-profit. ---
  const sellActions: AutoTradeResult['actions'] = [];
  for (const h of holdings) {
    const sig = cacheMap.get(h.ticker);
    const p = price(h.ticker) || h.buy_price;
    const plPct = h.buy_price > 0 ? ((p - h.buy_price) / h.buy_price) * 100 : 0;
    let why: string | null = null;
    if (sig?.verdict === 'SELL') why = 'SELL signal';
    else if (plPct <= config.stopLossPct) why = `stop-loss (${config.stopLossPct}%)`;
    else if (plPct >= config.takeProfitPct) why = `take-profit (+${config.takeProfitPct}%)`;
    if (!why) continue;
    const proceeds = h.qty * p;
    cash += proceeds;
    await admin.from('holdings').delete().eq('user_id', botId).eq('ticker', h.ticker);
    byTicker.delete(h.ticker);
    await logTrade(admin, botId, h.ticker, 'SELL', h.qty, p, h.company_name);
    sellActions.push({
      kind: 'EXIT', ticker: display(h.ticker), shares: h.qty, pesos: proceeds,
      reason: `${why} — sold all ${h.qty} unit(s) at ₱${p.toFixed(2)} (${plPct >= 0 ? '+' : ''}${plPct.toFixed(0)}% vs cost).`,
    });
  }

  // --- BUY/TRIM pass via the risk-managed advisor ---
  const positions: AdvisorPosition[] = [];
  for (const h of byTicker.values()) {
    const s = cacheMap.get(h.ticker);
    const verdict = s?.verdict === 'BUY' && !meetsMinConfidence(s?.confidence) ? 'HOLD' : (s?.verdict ?? null);
    positions.push({
      ticker: h.ticker, shares: h.qty, avgCost: h.buy_price, price: price(h.ticker) || h.buy_price,
      verdict, confidence: s?.confidence ?? null, stopLoss: s?.stop_loss ?? null,
    });
  }
  let buyCandidates = 0;
  for (const e of universe) {
    if (byTicker.has(e.ticker)) continue;
    const s = cacheMap.get(e.ticker);
    if (s?.verdict === 'BUY' && meetsMinConfidence(s?.confidence) && e.price > 0) {
      buyCandidates++;
      positions.push({ ticker: e.ticker, shares: 0, avgCost: 0, price: e.price, verdict: 'BUY', confidence: s.confidence ?? null, stopLoss: s.stop_loss ?? null });
    }
  }

  const advice = computeAdvice(positions, cash, {
    ...DEFAULT_ADVISOR_CONFIG, sizing: 'risk',
    maxWeightPct: config.maxWeightPct, riskPerTradePct: config.riskPerTradePct,
  });

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
        const name = uni.get(a.ticker)?.name ?? display(a.ticker);
        await admin.from('holdings').insert({ user_id: botId, ticker: a.ticker, company_name: name, qty: a.shares, buy_price: p, buy_date: today() });
        byTicker.set(a.ticker, { ticker: a.ticker, qty: a.shares, buy_price: p, company_name: name });
      }
      await logTrade(admin, botId, a.ticker, 'BUY', a.shares, p, uni.get(a.ticker)?.name);
      a.ticker = display(a.ticker);
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
      a.ticker = display(a.ticker);
    }
  }

  const actions = [...sellActions, ...advice.actions.filter((a) => a.kind !== 'EXIT')];

  // --- Persist cash, snapshot equity ---
  await admin.from('portfolio_cash').upsert({ user_id: botId, cash, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

  const finalHoldings = [...byTicker.values()].map((h) => {
    const p = price(h.ticker) || h.buy_price;
    return { ticker: display(h.ticker), qty: h.qty, avgCost: h.buy_price, price: p, value: h.qty * p };
  });
  const equity = cash + finalHoldings.reduce((s, h) => s + h.value, 0);
  await admin.from('balance_snapshots').upsert(
    { user_id: botId, snapshot_date: today(), total_value: equity },
    { onConflict: 'user_id,snapshot_date' },
  );

  return {
    ok: true, assetClass, ranAt: new Date().toISOString(), botUserId: botId,
    universe: universe.length, signalsComputed, buyCandidates,
    cashBefore, cashAfter: cash, equity,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    actions, holdings: finalHoldings, config,
  };
}

// Read-only snapshot of a bot's current state + equity curve (no trading).
export async function getBotState(assetClass: AssetClass = 'stock') {
  const admin = createSupabaseAdmin();
  const email = assetClass === 'crypto' ? CRYPTO_BOT_EMAIL : STOCK_BOT_EMAIL;
  const botId = await resolveBotUserId(admin, email);
  const [{ data: holdings }, { data: cashRow }, { data: snaps }, { data: trades }] = await Promise.all([
    admin.from('holdings').select('ticker, qty, buy_price, company_name').eq('user_id', botId),
    admin.from('portfolio_cash').select('cash').eq('user_id', botId).maybeSingle(),
    admin.from('balance_snapshots').select('snapshot_date, total_value').eq('user_id', botId).order('snapshot_date'),
    admin.from('paper_trades').select('ticker, action, qty, price, traded_at').eq('user_id', botId).order('traded_at', { ascending: false }).limit(50),
  ]);
  const universe = await loadUniverse(assetClass).catch(() => [] as UniverseEntry[]);
  const priceMap = new Map(universe.map((e) => [e.ticker, e.price]));
  const hs = (holdings ?? []).map((h: any) => {
    const p = priceMap.get(h.ticker) ?? Number(h.buy_price);
    return { ticker: display(h.ticker), qty: Number(h.qty), avgCost: Number(h.buy_price), price: p, value: Number(h.qty) * p };
  });
  const cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
  const equity = cash + hs.reduce((s, h) => s + h.value, 0);
  return {
    assetClass, botUserId: botId, cash, equity, holdings: hs,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    startingCash: STARTING_CASH,
    config: assetClass === 'crypto' ? CRYPTO_CONFIG : BOT_CONFIG,
    equityCurve: (snaps ?? []).map((s: any) => ({ date: s.snapshot_date, value: Number(s.total_value) })),
    recentTrades: (trades ?? []).map((t: any) => ({ ...t, ticker: display(t.ticker) })),
  };
}
