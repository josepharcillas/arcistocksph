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

import { query } from './db';
import { getOrCreateUser } from './repo';
import { fetchAllQuotes } from './market';
import { fetchTopCryptoQuotes, CRYPTO_PREFIX } from './market/crypto';
import { getOrComputeSignal } from './signals';
import { getOrComputeCryptoSignal } from './cryptoSignals';
import { computeAdvice, DEFAULT_ADVISOR_CONFIG, type AdvisorPosition } from './advisor';
import {
  meetsMinConfidence as meetsMin, pnlPct, exitReason, addToPosition,
  isConfirmed, holdElapsed, inCooldown, trailingStopHit, drawdownHalted,
  aboveTurnoverFloor, pickDiscoveryBatch, type SignalRecord,
} from './botLogic';
import type { SignalLogContext } from './signals';

export type AssetClass = 'stock' | 'crypto';

export const STARTING_CASH = 10000;
const FRESH_MS = 4 * 60 * 60 * 1000; // mirrors signal_cache TTL

const STOCK_BOT_EMAIL = process.env.BOT_EMAIL ?? 'bot@arcistocks.local';
const CRYPTO_BOT_EMAIL = process.env.CRYPTO_BOT_EMAIL ?? 'crypto-bot@arcistocks.local';

// Risk + discipline config per asset (override via env). The discipline layer is
// research-backed anti-churn (see 2026-07-02 agent reports): 200-day trend filter,
// signal confirmation across recomputes, minimum hold, re-entry cooldown, TRAILING
// stop instead of a fixed take-profit (let winners run), max buys/day, and a
// drawdown circuit breaker. Crypto runs wider stops because it's far more volatile.
export const BOT_CONFIG = {
  maxWeightPct: Number(process.env.BOT_MAX_WEIGHT_PCT ?? 15),
  riskPerTradePct: Number(process.env.BOT_RISK_PCT ?? 1),
  stopLossPct: Number(process.env.BOT_STOP_LOSS_PCT ?? -8),
  trailPct: Number(process.env.BOT_TRAIL_PCT ?? 10),            // trail exit % off peak
  minHoldDays: Number(process.env.BOT_MIN_HOLD_DAYS ?? 5),      // signal exits blocked before this
  cooldownDays: Number(process.env.BOT_COOLDOWN_DAYS ?? 5),     // no re-buy after selling
  maxBuysPerDay: Number(process.env.BOT_MAX_BUYS_PER_DAY ?? 2),
  drawdownHaltPct: Number(process.env.BOT_DRAWDOWN_HALT_PCT ?? 10), // halt buys below peak equity
  minBuyConfidence: (process.env.BOT_MIN_CONFIDENCE ?? 'HIGH').toUpperCase(),
  // Liquidity floor for money decisions (₱ median daily value traded, ~20 sessions).
  // At ~0.7% round-trip fees plus real slippage, sub-floor edge is unrecoverable —
  // and a paper fill at a thin stock's stale quote is fiction anyway.
  minTurnover: Number(process.env.STOCK_MIN_TURNOVER ?? 5_000_000),
};
export const CRYPTO_CONFIG = {
  maxWeightPct: Number(process.env.BOT_CRYPTO_MAX_WEIGHT_PCT ?? 20),
  riskPerTradePct: Number(process.env.BOT_CRYPTO_RISK_PCT ?? 1),
  stopLossPct: Number(process.env.BOT_CRYPTO_STOP_LOSS_PCT ?? -15),
  trailPct: Number(process.env.BOT_CRYPTO_TRAIL_PCT ?? 20),
  minHoldDays: Number(process.env.BOT_CRYPTO_MIN_HOLD_DAYS ?? 5),
  cooldownDays: Number(process.env.BOT_CRYPTO_COOLDOWN_DAYS ?? 5),
  maxBuysPerDay: Number(process.env.BOT_CRYPTO_MAX_BUYS_PER_DAY ?? 2),
  drawdownHaltPct: Number(process.env.BOT_CRYPTO_DRAWDOWN_HALT_PCT ?? 15),
  // MEDIUM (not HIGH): the AI almost never rates crypto HIGH, so HIGH-only left the
  // bot inert (0 trades). MEDIUM lets it participate; the -15% stop still caps risk.
  minBuyConfidence: (process.env.BOT_CRYPTO_MIN_CONFIDENCE ?? 'MEDIUM').toUpperCase(),
  minTurnover: 0, // CoinGecko universe is already liquidity-floored (CRYPTO_MIN_VOLUME)
};

// Trading costs, folded into the executed price so ALL P/L math (equity, realized,
// win-rate replays) reflects them automatically — no fake, cost-free profits.
// PSE round-trip ≈ 0.70% since July 2025 (CMEPA cut the stock txn tax 0.6%→0.1%):
// buy ≈ 0.295%, sell ≈ 0.395% (commission+VAT+PSE/SCCP fees+0.1% STT).
// Crypto ~0.25% per side (typical exchange taker fee). Override via env.
export const STOCK_FEES = { buyPct: Number(process.env.BOT_STOCK_BUY_FEE ?? 0.00295), sellPct: Number(process.env.BOT_STOCK_SELL_FEE ?? 0.00395) };
export const CRYPTO_FEES = { buyPct: Number(process.env.BOT_CRYPTO_BUY_FEE ?? 0.0025), sellPct: Number(process.env.BOT_CRYPTO_SELL_FEE ?? 0.0025) };


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
  fees: typeof STOCK_FEES;
}

export interface AutoTradeOptions {
  assetClass?: AssetClass;
  batchSize?: number;
}

interface UniverseEntry { ticker: string; price: number; name: string; symbol: string; id?: string; dayTurnover?: number }
interface HoldingRow { ticker: string; qty: number; buy_price: number; buy_date: string | null; peak_price: number | null; company_name: string }

const today = () => new Date().toISOString().slice(0, 10);
const display = (t: string) => t.replace(new RegExp('^' + CRYPTO_PREFIX), '');

async function loadUniverse(assetClass: AssetClass): Promise<UniverseEntry[]> {
  if (assetClass === 'crypto') {
    // Whole active market: top 250 by cap with a liquidity floor (see crypto.ts).
    const m = await fetchTopCryptoQuotes(Number(process.env.CRYPTO_UNIVERSE ?? 250));
    return [...m.values()].map((c) => ({ ticker: c.ticker, price: c.price, name: c.name, symbol: c.symbol, id: c.id }));
  }
  const m = await fetchAllQuotes();
  return [...m.values()].filter((q) => q.price > 0).map((q) => ({
    ticker: q.symbol, price: q.price, name: q.name, symbol: q.symbol,
    dayTurnover: q.price * (q.volume ?? 0), // today's peso turnover — the scan-allocation weight
  }));
}

async function computeSignalFor(assetClass: AssetClass, e: UniverseEntry, log: SignalLogContext) {
  if (assetClass === 'crypto') return getOrComputeCryptoSignal(e.ticker, e.id ?? e.symbol, e.symbol, e.name, log);
  return getOrComputeSignal(e.ticker, e.name, log);
}

async function logTrade(
  userId: string, ticker: string, action: 'BUY' | 'SELL', qty: number, price: number, name?: string, reason?: string,
) {
  await query(
    `insert into paper_trades (user_id, ticker, company_name, action, qty, price, reason)
       values ($1,$2,$3,$4,$5,$6,$7)`,
    [userId, ticker, name ?? ticker, action, qty, price, reason ?? null]
  ).catch((err) => console.warn('[auto-trade] trade log failed', err instanceof Error ? err.message : err));
}

export async function runAutoTrade(opts: AutoTradeOptions = {}): Promise<AutoTradeResult> {
  const assetClass: AssetClass = opts.assetClass ?? 'stock';
  const config = assetClass === 'crypto' ? CRYPTO_CONFIG : BOT_CONFIG;
  const fees = assetClass === 'crypto' ? CRYPTO_FEES : STOCK_FEES;
  const email = assetClass === 'crypto' ? CRYPTO_BOT_EMAIL : STOCK_BOT_EMAIL;
  const meetsMinConfidence = (c?: string | null) => meetsMin(c, config.minBuyConfidence);
  const defaultBatch = assetClass === 'crypto' ? 6 : 25;
  const batchSize = opts.batchSize ?? Number(process.env.AUTOTRADE_BATCH ?? defaultBatch);

  const botId = (await getOrCreateUser(email)).id;

  // --- Load bot state (+ data the discipline rules need) ---
  const cooldownSince = new Date(Date.now() - config.cooldownDays * 86400000).toISOString();
  const [holdingsRows, cashRow, recentTrades, peakSnap] = await Promise.all([
    query<HoldingRow>(`select ticker, qty, buy_price, buy_date, peak_price, company_name from holdings where user_id = $1`, [botId]),
    query<{ cash: number }>(`select cash from portfolio_cash where user_id = $1`, [botId]).then((r) => r[0] ?? null),
    query<{ ticker: string; action: string; traded_at: string }>(
      `select ticker, action, traded_at from paper_trades where user_id = $1 and traded_at >= $2`,
      [botId, cooldownSince]
    ),
    query<{ total_value: number }>(
      `select total_value from balance_snapshots where user_id = $1 order by total_value desc limit 1`,
      [botId]
    ),
  ]);
  const holdings = holdingsRows.map((h) => ({
    ticker: h.ticker, qty: Number(h.qty), buy_price: Number(h.buy_price),
    buy_date: h.buy_date ?? null, peak_price: h.peak_price != null ? Number(h.peak_price) : null,
    company_name: h.company_name ?? h.ticker,
  }));
  let cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
  const cashBefore = cash;

  // Cooldown (last SELL per ticker) and today's buy count, from the bot's own log.
  const lastSellAt = new Map<string, string>();
  let buysToday = 0;
  const dayStart = today();
  for (const t of recentTrades) {
    if (t.action === 'SELL') {
      const prev = lastSellAt.get(t.ticker);
      if (!prev || t.traded_at > prev) lastSellAt.set(t.ticker, t.traded_at);
    } else if (t.traded_at.slice(0, 10) === dayStart) {
      buysToday++;
    }
  }
  const peakEquity = peakSnap[0] ? Number(peakSnap[0].total_value) : STARTING_CASH;

  // --- Live universe (one bulk call) ---
  const universe = await loadUniverse(assetClass);
  const uni = new Map(universe.map((e) => [e.ticker, e]));
  const price = (t: string) => uni.get(t)?.price ?? 0;
  const held = new Set(holdings.map((h) => h.ticker));

  // --- Decide which tickers to (re)compute signals for. Three tiers:
  //     1. HELD — always re-checked, so exits fire.
  //     2. WATCH — non-held tickers whose last signal was a qualifying BUY: these
  //        must be re-analyzed every run to build the 24h confirmation streak
  //        (a one-off scan can never confirm).
  //     3. DISCOVERY — two measurable arms over the remaining stale universe:
  //        turnover-WEIGHTED (scan budget follows where the market actually
  //        trades) + a uniform-random CONTROL arm (unbiased sample for the
  //        accuracy tracker; also audits below-floor names without ever
  //        surfacing them — the buy gate still blocks those).
  const cacheRows = await query<any>(
    `select ticker, verdict, confidence, stop_loss, above_sma200, turnover20d, computed_at from signal_cache`
  );
  const cacheMap = new Map<string, any>(cacheRows.map((r: any) => [r.ticker, r]));
  const isFresh = (t: string) => {
    const c = cacheMap.get(t);
    return c && Date.now() - new Date(c.computed_at).getTime() < FRESH_MS;
  };
  // Liquidity floor for money decisions, from the ticker's cached 20d median
  // turnover. Strict like the SMA filter: unknown = no. Floor 0 disables (crypto).
  const aboveFloor = (t: string) => {
    const s = cacheMap.get(t);
    return aboveTurnoverFloor(s?.turnover20d != null ? Number(s.turnover20d) : null, config.minTurnover);
  };

  const watch = universe
    .map((e) => e.ticker)
    .filter((t) => {
      if (held.has(t)) return false;
      const s = cacheMap.get(t);
      return s?.verdict === 'BUY' && meetsMin(s?.confidence, config.minBuyConfidence)
        && s?.above_sma200 !== false && aboveFloor(t); // don't spend budget tracking unbuyable names
    })
    .slice(0, 15); // bound the AI budget spent tracking candidates
  const watchSet = new Set(watch);

  const pool = universe.filter((e) => !held.has(e.ticker) && !watchSet.has(e.ticker) && !isFresh(e.ticker));
  const batch = pickDiscoveryBatch(pool, (e) => e.dayTurnover ?? 0, batchSize, config.minTurnover);
  const armOf = new Map<string, SignalLogContext['arm']>();
  for (const e of batch.weighted) armOf.set(e.ticker, 'weighted');
  for (const e of batch.control) armOf.set(e.ticker, 'control');
  const newCandidates = [...batch.weighted, ...batch.control].map((e) => e.ticker);
  const toCompute = [...new Set([...held, ...watch.filter((t) => !isFresh(t)), ...newCandidates])];

  // Pace fresh AI calls to fit free-tier rate limits (Gemini free = 20 req/min;
  // bursts cascade 429s into the Groq fallback). Cached hits skip the wait.
  const aiDelayMs = Number(process.env.AI_CALL_DELAY_MS ?? 3500);
  const pace = () => new Promise((r) => setTimeout(r, aiDelayMs));

  let signalsComputed = 0;
  for (const t of toCompute) {
    const e = uni.get(t);
    if (!e) continue; // held item no longer in the universe (e.g. fell out of top-N) — keep cached
    const log: SignalLogContext = held.has(t)
      ? { source: 'held' }
      : watchSet.has(t) ? { source: 'watch' } : { source: 'discovery', arm: armOf.get(t) ?? null };
    try {
      const r = await computeSignalFor(assetClass, e, log);
      if (!r.cached) { signalsComputed++; await pace(); }
      cacheMap.set(t, {
        ticker: t, verdict: r.verdict, confidence: r.confidence, stop_loss: r.stopLoss,
        above_sma200: r.aboveSma200 ?? null, turnover20d: r.turnover20d ?? null, computed_at: r.analyzedAt,
      });
    } catch (err) {
      console.warn('[auto-trade] signal failed for', t, err instanceof Error ? err.message : err);
      await pace(); // failures burn rate-limit budget too
    }
  }

  const byTicker = new Map(holdings.map((h) => [h.ticker, { ...h }]));

  // Signal-history for confirmation (newest-first per ticker): held tickers +
  // anything carrying a fresh BUY. One query, grouped in memory.
  const interesting = new Set<string>(holdings.map((h) => h.ticker));
  for (const e of universe) {
    const s = cacheMap.get(e.ticker);
    if (s?.verdict === 'BUY' && meetsMinConfidence(s?.confidence)) interesting.add(e.ticker);
  }
  const histMap = new Map<string, SignalRecord[]>();
  if (interesting.size > 0) {
    const histRows = await query<{ ticker: string; verdict: string; created_at: string }>(
      `select ticker, verdict, created_at from signal_history
         where ticker = any($1::text[]) order by created_at desc limit $2`,
      [[...interesting], interesting.size * 10]
    );
    for (const r of histRows) {
      const arr = histMap.get(r.ticker) ?? [];
      if (arr.length < 10) arr.push({ verdict: r.verdict, created_at: r.created_at });
      histMap.set(r.ticker, arr);
    }
  }
  const confirmed = (t: string, verdict: string) => isConfirmed(histMap.get(t) ?? [], verdict);

  // --- SELL pass (discipline order): hard stop-loss always fires; trailing stop
  //     lets winners run then exits when they roll over; a SELL signal exits only
  //     when it's CONFIRMED across recomputes AND the minimum hold has elapsed.
  const sellActions: AutoTradeResult['actions'] = [];
  for (const h of holdings) {
    const sig = cacheMap.get(h.ticker);
    const p = price(h.ticker) || h.buy_price;
    const pl = pnlPct(p, h.buy_price);

    // Track the post-entry peak for the trailing stop (persist best-effort).
    const peak = Math.max(h.peak_price ?? h.buy_price, p);
    if (peak !== h.peak_price) {
      await query(`update holdings set peak_price = $1 where user_id = $2 and ticker = $3`, [peak, botId, h.ticker]);
      h.peak_price = peak;
      const heldRow = byTicker.get(h.ticker); if (heldRow) heldRow.peak_price = peak;
    }

    const gatedVerdict = sig?.verdict === 'SELL' && holdElapsed(h.buy_date, config.minHoldDays) && confirmed(h.ticker, 'SELL')
      ? 'SELL' : 'HOLD';
    const why = exitReason(gatedVerdict, pl, { stopLossPct: config.stopLossPct, takeProfitPct: Infinity })
      ?? trailingStopHit(p, peak, config.trailPct);
    if (!why) continue;

    const net = p * (1 - fees.sellPct); // price received after selling fee
    const proceeds = h.qty * net;
    cash += proceeds;
    await query(`delete from holdings where user_id = $1 and ticker = $2`, [botId, h.ticker]);
    byTicker.delete(h.ticker);
    const exitReasonText = `${why === 'SELL signal' ? 'confirmed SELL signal' : why} — sold all ${h.qty} unit(s) at ₱${p.toFixed(2)} (${pl >= 0 ? '+' : ''}${pl.toFixed(0)}% vs cost).`;
    await logTrade(botId, h.ticker, 'SELL', h.qty, net, h.company_name, exitReasonText);
    sellActions.push({
      kind: 'EXIT', ticker: display(h.ticker), shares: h.qty, pesos: proceeds,
      reason: exitReasonText,
    });
  }

  // --- BUY/TRIM pass via the risk-managed advisor, with the discipline gates:
  //     trend filter (only buy above the 200-day SMA), confirmation (BUY must
  //     persist across recomputes), re-entry cooldown, and a drawdown halt.
  const equityNow = cash + [...byTicker.values()].reduce((s, h) => s + h.qty * (price(h.ticker) || h.buy_price), 0);
  const halted = drawdownHalted(equityNow, peakEquity, config.drawdownHaltPct);

  const buyable = (t: string): boolean => {
    const s = cacheMap.get(t);
    return !halted
      && s?.verdict === 'BUY'
      && meetsMinConfidence(s?.confidence)
      && s?.above_sma200 === true      // 200-day trend filter (strict: unknown = no)
      && aboveFloor(t)                 // liquidity floor — no money into thin names
      && confirmed(t, 'BUY')           // signal persisted across recomputes
      && !inCooldown(lastSellAt.get(t), config.cooldownDays);
  };

  const positions: AdvisorPosition[] = [];
  for (const h of byTicker.values()) {
    const s = cacheMap.get(h.ticker);
    // Adds to an existing position face the same gates as new entries.
    const verdict = s?.verdict === 'BUY' && !buyable(h.ticker) ? 'HOLD' : (s?.verdict ?? null);
    positions.push({
      ticker: h.ticker, shares: h.qty, avgCost: h.buy_price, price: price(h.ticker) || h.buy_price,
      verdict, confidence: s?.confidence ?? null, stopLoss: s?.stop_loss ?? null,
    });
  }
  let buyCandidates = 0;
  for (const e of universe) {
    if (byTicker.has(e.ticker)) continue;
    if (e.price > 0 && buyable(e.ticker)) {
      const s = cacheMap.get(e.ticker);
      buyCandidates++;
      positions.push({ ticker: e.ticker, shares: 0, avgCost: 0, price: e.price, verdict: 'BUY', confidence: s.confidence ?? null, stopLoss: s.stop_loss ?? null });
    }
  }

  const advice = computeAdvice(positions, cash, {
    ...DEFAULT_ADVISOR_CONFIG, sizing: 'risk',
    maxWeightPct: config.maxWeightPct, riskPerTradePct: config.riskPerTradePct,
  });

  let buysThisRun = 0;
  for (const a of advice.actions) {
    if (a.kind === 'BUY' && a.ticker && a.shares) {
      // Turnover cap: a slow-growth bot trades a few times per WEEK, not per run.
      if (buysToday + buysThisRun >= config.maxBuysPerDay) continue;
      const mkt = price(a.ticker);
      if (mkt <= 0) continue;
      const effPrice = mkt * (1 + fees.buyPct); // cost basis includes the buying fee
      let shares = a.shares;
      const affordable = Math.floor((cash + 1e-6) / effPrice);
      if (affordable < shares) shares = affordable; // fee may shave the last unit
      if (shares < 1) continue;
      const cost = shares * effPrice;
      cash -= cost;
      buysThisRun++;
      const ex = byTicker.get(a.ticker);
      if (ex) {
        const { qty: newQty, avgCost: newAvg } = addToPosition(ex.qty, ex.buy_price, shares, effPrice);
        const newPeak = Math.max(ex.peak_price ?? ex.buy_price, effPrice);
        await query(
          `update holdings set qty = $1, buy_price = $2, peak_price = $3 where user_id = $4 and ticker = $5`,
          [newQty, newAvg, newPeak, botId, a.ticker]
        );
        ex.qty = newQty; ex.buy_price = newAvg; ex.peak_price = newPeak;
      } else {
        const name = uni.get(a.ticker)?.name ?? display(a.ticker);
        await query(
          `insert into holdings (user_id, ticker, company_name, qty, buy_price, buy_date, peak_price)
             values ($1,$2,$3,$4,$5,$6,$7)`,
          [botId, a.ticker, name, shares, effPrice, today(), effPrice]
        );
        byTicker.set(a.ticker, { ticker: a.ticker, qty: shares, buy_price: effPrice, buy_date: today(), peak_price: effPrice, company_name: name });
      }
      await logTrade(botId, a.ticker, 'BUY', shares, effPrice, uni.get(a.ticker)?.name, a.reason);
      a.ticker = display(a.ticker); a.shares = shares; a.pesos = cost;
    } else if (a.kind === 'TRIM' && a.ticker && a.shares) {
      const ex = byTicker.get(a.ticker);
      if (!ex) continue;
      const net = (price(a.ticker) || ex.buy_price) * (1 - fees.sellPct);
      cash += a.shares * net;
      const newQty = ex.qty - a.shares;
      if (newQty <= 0.0001) {
        await query(`delete from holdings where user_id = $1 and ticker = $2`, [botId, a.ticker]);
        byTicker.delete(a.ticker);
      } else {
        await query(`update holdings set qty = $1 where user_id = $2 and ticker = $3`, [newQty, botId, a.ticker]);
        ex.qty = newQty;
      }
      await logTrade(botId, a.ticker, 'SELL', a.shares, net, ex.company_name, a.reason);
      a.ticker = display(a.ticker);
    }
  }

  // Advisor BUY/TRIM reasons say "share(s)"; for crypto, read "unit(s)".
  const advActions = advice.actions
    .filter((a) => a.kind !== 'EXIT')
    .map((a) => (assetClass === 'crypto' ? { ...a, reason: a.reason.replace(/share\(s\)/g, 'unit(s)') } : a));
  const actions = [...sellActions, ...advActions];

  // --- Persist cash, snapshot equity ---
  await query(
    `insert into portfolio_cash (user_id, cash, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set cash = excluded.cash, updated_at = now()`,
    [botId, cash]
  );

  const finalHoldings = [...byTicker.values()].map((h) => {
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
    ok: true, assetClass, ranAt: new Date().toISOString(), botUserId: botId,
    universe: universe.length, signalsComputed, buyCandidates,
    cashBefore, cashAfter: cash, equity,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    actions, holdings: finalHoldings, config, fees,
  };
}

// Read-only snapshot of a bot's current state + equity curve (no trading).
export async function getBotState(assetClass: AssetClass = 'stock') {
  const email = assetClass === 'crypto' ? CRYPTO_BOT_EMAIL : STOCK_BOT_EMAIL;
  const botId = (await getOrCreateUser(email)).id;
  const [holdings, cashRow, snaps, trades] = await Promise.all([
    query<any>(`select ticker, qty, buy_price, company_name from holdings where user_id = $1`, [botId]),
    query<{ cash: number }>(`select cash from portfolio_cash where user_id = $1`, [botId]).then((r) => r[0] ?? null),
    query<any>(`select snapshot_date, total_value from balance_snapshots where user_id = $1 order by snapshot_date`, [botId]),
    query<any>(`select ticker, action, qty, price, traded_at from paper_trades where user_id = $1 order by traded_at desc limit 50`, [botId]),
  ]);
  const universe = await loadUniverse(assetClass).catch(() => [] as UniverseEntry[]);
  const priceMap = new Map(universe.map((e) => [e.ticker, e.price]));
  const hs = holdings.map((h: any) => {
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
    fees: assetClass === 'crypto' ? CRYPTO_FEES : STOCK_FEES,
    equityCurve: snaps.map((s: any) => ({ date: s.snapshot_date, value: Number(s.total_value) })),
    recentTrades: trades.map((t: any) => ({ ...t, ticker: display(t.ticker) })),
  };
}
