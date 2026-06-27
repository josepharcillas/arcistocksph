// Prints a performance report for a ₱10k auto-trading bot.
// Standalone: reads local Supabase (service role) + live prices directly, so it
// works whether or not the dev server is running.
//
//   node scripts/bot-report.mjs            # stock bot
//   node scripts/bot-report.mjs --crypto   # crypto bot
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const CRYPTO = process.argv.includes('--crypto');
const EMAIL = CRYPTO ? 'crypto-bot@arcistocks.local' : 'bot@arcistocks.local';
const TITLE = CRYPTO ? 'AI AUTO-TRADER — CRYPTO' : 'AI AUTO-TRADER — STOCKS';
const STARTING_CASH = 10000;
const PREFIX = 'X:';
const strip = (t) => String(t).replace(/^X:/, '');

// Mirrors BOT_CONFIG / CRYPTO_CONFIG defaults in src/lib/autoTrade.ts.
const RISK = CRYPTO ? {
  maxWeightPct: Number(process.env.BOT_CRYPTO_MAX_WEIGHT_PCT ?? 20),
  riskPerTradePct: Number(process.env.BOT_CRYPTO_RISK_PCT ?? 1),
  stopLossPct: Number(process.env.BOT_CRYPTO_STOP_LOSS_PCT ?? -15),
  takeProfitPct: Number(process.env.BOT_CRYPTO_TAKE_PROFIT_PCT ?? 35),
  minBuyConfidence: (process.env.BOT_CRYPTO_MIN_CONFIDENCE ?? 'HIGH').toUpperCase(),
} : {
  maxWeightPct: Number(process.env.BOT_MAX_WEIGHT_PCT ?? 15),
  riskPerTradePct: Number(process.env.BOT_RISK_PCT ?? 1),
  stopLossPct: Number(process.env.BOT_STOP_LOSS_PCT ?? -8),
  takeProfitPct: Number(process.env.BOT_TAKE_PROFIT_PCT ?? 20),
  minBuyConfidence: (process.env.BOT_MIN_CONFIDENCE ?? 'HIGH').toUpperCase(),
};

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

// Live prices keyed by the STORED ticker (crypto uses the "X:" prefix in the DB).
async function liveQuotes() {
  const m = new Map();
  if (CRYPTO) {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=php&order=market_cap_desc&per_page=100&page=1', { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.ok) for (const c of await r.json()) m.set(PREFIX + String(c.symbol).toUpperCase(), c.current_price ?? 0);
    } catch { /* offline */ }
    return m;
  }
  for (const host of ['https://phisix-api3.appspot.com', 'https://phisix-api4.appspot.com']) {
    try {
      const r = await fetch(`${host}/stocks.json`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const j = await r.json();
      for (const s of j?.stocks ?? []) m.set(s.symbol, s.price?.amount ?? 0);
      if (m.size) return m;
    } catch { /* next host */ }
  }
  return m;
}

const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
const user = list?.users?.find((u) => u.email === EMAIL);
if (!user) { console.error(`Bot user ${EMAIL} not found — run: node scripts/seed-bot.mjs`); process.exit(1); }
const uid = user.id;

const [{ data: holdings }, { data: cashRow }, { data: snaps }, { data: trades }, quotes] = await Promise.all([
  admin.from('holdings').select('ticker, qty, buy_price, company_name').eq('user_id', uid),
  admin.from('portfolio_cash').select('cash').eq('user_id', uid).maybeSingle(),
  admin.from('balance_snapshots').select('snapshot_date, total_value').eq('user_id', uid).order('snapshot_date'),
  admin.from('paper_trades').select('ticker, action, qty, price, total, traded_at').eq('user_id', uid).order('traded_at', { ascending: false }),
  liveQuotes(),
]);

const cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
const hs = (holdings ?? []).map((h) => {
  const price = quotes.get(h.ticker) ?? Number(h.buy_price);
  const value = Number(h.qty) * price;
  const cost = Number(h.qty) * Number(h.buy_price);
  return { ticker: strip(h.ticker), qty: Number(h.qty), avg: Number(h.buy_price), price, value, plPesos: value - cost, plPct: cost > 0 ? ((value - cost) / cost) * 100 : 0 };
}).sort((a, b) => b.value - a.value);

const holdingsValue = hs.reduce((s, h) => s + h.value, 0);
const equity = cash + holdingsValue;
const totalPl = equity - STARTING_CASH;
const totalPlPct = (totalPl / STARTING_CASH) * 100;

const line = '─'.repeat(72);
console.log('\n' + line);
console.log('  🤖 ARCISTOCKS ' + TITLE + ' — PERFORMANCE REPORT');
console.log('  as of ' + new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }));
console.log(line);

console.log('  ACCOUNT');
console.log('    Starting capital   ' + padL(peso(STARTING_CASH), 16));
console.log('    Cash               ' + padL(peso(cash), 16));
console.log('    Holdings value     ' + padL(peso(holdingsValue), 16));
console.log('    ─────────────────  ' + padL('', 16).replace(/ /g, ''));
console.log('    Total equity       ' + padL(peso(equity), 16));
console.log('    Total P/L          ' + padL(peso(totalPl), 16) + '   (' + pct(totalPlPct) + ')');

console.log('\n  RISK SETTINGS (capital protection)');
console.log('    Stop-loss (auto-sell)    ' + padL(RISK.stopLossPct + '%', 8));
console.log('    Take-profit (auto-sell)  ' + padL('+' + RISK.takeProfitPct + '%', 8));
console.log('    Max per stock            ' + padL(RISK.maxWeightPct + '%', 8));
console.log('    Risk per trade           ' + padL(RISK.riskPerTradePct + '%', 8));
console.log('    Min BUY confidence       ' + padL(RISK.minBuyConfidence, 8));

// Decision accuracy: replay the trade log oldest-first, computing realized P/L on
// every SELL (vs running average cost) → win rate = how often the bot was right.
const chrono = [...(trades ?? [])].reverse();
const book = {};
let wins = 0, losses = 0, realized = 0, closed = 0;
for (const t of chrono) {
  const b = (book[t.ticker] ??= { qty: 0, cost: 0 });
  const q = Number(t.qty), pr = Number(t.price);
  if (t.action === 'BUY') { b.cost += q * pr; b.qty += q; }
  else {
    const avg = b.qty > 0 ? b.cost / b.qty : pr;
    const pl = (pr - avg) * q;
    realized += pl; closed++; if (pl >= 0) wins++; else losses++;
    b.qty -= q; b.cost -= avg * q;
  }
}
console.log('\n  DECISION ACCURACY (closed trades)');
if (closed === 0) {
  console.log('    — no closed trades yet (positions still open) —');
} else {
  console.log('    Closed trades       ' + padL(closed, 8));
  console.log('    Wins / Losses       ' + padL(wins + ' / ' + losses, 8));
  console.log('    Win rate            ' + padL(((wins / closed) * 100).toFixed(0) + '%', 8));
  console.log('    Realized P/L        ' + padL(peso(realized), 12));
}

console.log('\n  POSITIONS (' + hs.length + ')');
if (hs.length === 0) {
  console.log('    — none (all cash) —');
} else {
  console.log('    ' + pad('TICKER', 8) + padL('QTY', 7) + padL('AVG', 11) + padL('PRICE', 11) + padL('VALUE', 13) + padL('P/L', 13) + padL('%', 9));
  for (const h of hs) {
    console.log('    ' + pad(h.ticker, 8) + padL(h.qty, 7) + padL(peso(h.avg), 11) + padL(peso(h.price), 11) + padL(peso(h.value), 13) + padL(peso(h.plPesos), 13) + padL(pct(h.plPct), 9));
  }
}

console.log('\n  EQUITY CURVE (' + (snaps?.length ?? 0) + ' day' + ((snaps?.length ?? 0) === 1 ? '' : 's') + ')');
if (!snaps?.length) {
  console.log('    — no snapshots yet —');
} else {
  let prev = STARTING_CASH;
  for (const s of snaps) {
    const v = Number(s.total_value);
    const chg = ((v - prev) / prev) * 100;
    console.log('    ' + pad(s.snapshot_date, 14) + padL(peso(v), 14) + padL(pct(chg), 10));
    prev = v;
  }
}

console.log('\n  TRADE LOG (' + (trades?.length ?? 0) + ')');
if (!trades?.length) {
  console.log('    — no trades yet —');
} else {
  for (const t of trades.slice(0, 25)) {
    const when = new Date(t.traded_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    const tag = t.action === 'BUY' ? 'BUY ' : 'SELL';
    console.log('    ' + pad(when, 9) + pad(tag, 6) + pad(strip(t.ticker), 8) + padL(t.qty + ' @ ' + peso(t.price), 22) + padL('= ' + peso(t.total), 16));
  }
  if (trades.length > 25) console.log('    … and ' + (trades.length - 25) + ' more');
}

console.log(line);
console.log('  Not financial advice — paper-trading simulation only.\n');
