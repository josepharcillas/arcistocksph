// One-glance scoreboard: STOCK bot vs CRYPTO bot, each vs a buy-and-hold benchmark.
// Benchmarks answer "does the bot beat just holding?": crypto vs BTC hold (since the
// bot started), stocks vs an equal-weight PSEi-30 basket (baseline tracked forward).
// Standalone — reads local Supabase + live prices directly (no server needed).
//
//   node scripts/scoreboard.mjs
import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const URL = 'http://127.0.0.1:54321';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const STARTING_CASH = 10000;
const BASELINE_FILE = path.resolve(process.cwd(), 'data', 'benchmark-baseline.json');

// Representative PSEi blue chips (the index proxy for the stock benchmark).
const PSEI = ['SM','SMPH','BDO','BPI','MBT','AC','ALI','JFC','URC','TEL','GLO','AEV','AP','ICT','JGS','MER','MONDE','PGOLD','RLC','SCC','SMC','GTCAP','LTG','ACEN','CNVRG','DMC','NIKL','AGI','BLOOM','CNPF'];

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%');

async function stockPrices() {
  const m = new Map();
  for (const host of ['https://phisix-api3.appspot.com', 'https://phisix-api4.appspot.com']) {
    try {
      const r = await fetch(`${host}/stocks.json`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      for (const s of (await r.json())?.stocks ?? []) m.set(s.symbol, s.price?.amount ?? 0);
      if (m.size) break;
    } catch { /* next */ }
  }
  return m;
}
async function cryptoPrices() {
  const m = new Map();
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=php&order=market_cap_desc&per_page=100&page=1', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (r.ok) for (const c of await r.json()) m.set('X:' + String(c.symbol).toUpperCase(), c.current_price ?? 0);
  } catch { /* offline */ }
  return m;
}

async function summarize(email, prices) {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  const user = list?.users?.find((u) => u.email === email);
  if (!user) return null;
  const uid = user.id;
  const [{ data: holdings }, { data: cashRow }, { data: trades }, { data: snaps }] = await Promise.all([
    admin.from('holdings').select('ticker, qty, buy_price').eq('user_id', uid),
    admin.from('portfolio_cash').select('cash').eq('user_id', uid).maybeSingle(),
    admin.from('paper_trades').select('ticker, action, qty, price').eq('user_id', uid).order('traded_at', { ascending: true }),
    admin.from('balance_snapshots').select('snapshot_date').eq('user_id', uid).order('snapshot_date').limit(1),
  ]);
  const cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
  const holdingsValue = (holdings ?? []).reduce((s, h) => s + Number(h.qty) * (prices.get(h.ticker) ?? Number(h.buy_price)), 0);
  const equity = cash + holdingsValue;
  const book = {}; let wins = 0, closed = 0, realized = 0;
  for (const t of trades ?? []) {
    const b = (book[t.ticker] ??= { qty: 0, cost: 0 });
    const q = Number(t.qty), pr = Number(t.price);
    if (t.action === 'BUY') { b.cost += q * pr; b.qty += q; }
    else { const avg = b.qty > 0 ? b.cost / b.qty : pr; const pl = (pr - avg) * q; realized += pl; closed++; if (pl >= 0) wins++; b.qty -= q; b.cost -= avg * q; }
  }
  return {
    cash, equity, positions: (holdings ?? []).length, trades: (trades ?? []).length,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    closed, winRate: closed ? (wins / closed) * 100 : null, realized,
    startDate: snaps?.[0]?.snapshot_date ?? null,
  };
}

// BTC buy-and-hold % return since `sinceDate` (CoinGecko history, PHP).
async function btcReturnSince(sinceDate) {
  if (!sinceDate) return null;
  const days = Math.min(365, Math.max(2, Math.ceil((Date.now() - new Date(sinceDate).getTime()) / 86400000) + 1));
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=php&days=${days}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const prices = (await r.json())?.prices ?? [];
    if (prices.length < 2) return null;
    const ts = new Date(sinceDate).getTime();
    const base = (prices.find((p) => p[0] >= ts) ?? prices[0])[1];
    const cur = prices[prices.length - 1][1];
    return base > 0 ? (cur / base - 1) * 100 : null;
  } catch { return null; }
}

// Equal-weight PSEi-30 basket % return vs a stored baseline (forward-tracked).
async function stockBasketReturn(sp) {
  let data = {};
  try { data = JSON.parse(await fs.readFile(BASELINE_FILE, 'utf8')); } catch { /* first run */ }
  if (!data.stock) {
    const pricesAtBase = {};
    for (const t of PSEI) { const p = sp.get(t); if (p > 0) pricesAtBase[t] = p; }
    data.stock = { date: new Date().toISOString().slice(0, 10), prices: pricesAtBase };
    try { await fs.mkdir(path.dirname(BASELINE_FILE), { recursive: true }); await fs.writeFile(BASELINE_FILE, JSON.stringify(data, null, 2)); } catch { /* ignore */ }
    return { ret: null, since: data.stock.date };
  }
  const rets = [];
  for (const [t, base] of Object.entries(data.stock.prices)) { const cur = sp.get(t); if (cur > 0 && base > 0) rets.push(cur / base - 1); }
  const ret = rets.length ? (rets.reduce((s, x) => s + x, 0) / rets.length) * 100 : null;
  return { ret, since: data.stock.date };
}

const [sp, cp] = await Promise.all([stockPrices(), cryptoPrices()]);
const [stock, crypto] = await Promise.all([
  summarize('bot@arcistocks.local', sp),
  summarize('crypto-bot@arcistocks.local', cp),
]);
const [btcBench, stockBench] = await Promise.all([
  btcReturnSince(crypto?.startDate),
  stockBasketReturn(sp),
]);

const row = (label, fn) => '  ' + String(label).padEnd(20) + String(stock ? fn(stock) : '—').padStart(16) + String(crypto ? fn(crypto) : '—').padStart(16);
const line = '─'.repeat(56);
console.log('\n' + line);
console.log('  🏆 ARCISTOCKS BOT SCOREBOARD   ' + new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }));
console.log(line);
console.log('  ' + ''.padEnd(20) + 'STOCKS'.padStart(16) + 'CRYPTO'.padStart(16));
console.log(line);
console.log(row('Equity', (s) => peso(s.equity)));
console.log(row('Bot return', (s) => pct(s.pnlPct)));
console.log(row('Cash', (s) => peso(s.cash)));
console.log(row('Open positions', (s) => s.positions));
console.log(row('Trades', (s) => s.trades));
console.log(row('Win rate', (s) => (s.winRate == null ? '—' : s.winRate.toFixed(0) + '%')));
console.log(row('Realized P/L', (s) => peso(s.realized)));
console.log(line);
console.log('  BUY & HOLD BENCHMARK (does the bot beat just holding?)');
console.log('  ' + 'Benchmark'.padEnd(20) + ('PSEi-30 ' + pct(stockBench.ret)).padStart(16) + ('BTC ' + pct(btcBench)).padStart(16));
const alpha = (botPnl, bench) => (botPnl == null || bench == null) ? '—' : pct(botPnl - bench);
console.log('  ' + 'Bot vs benchmark'.padEnd(20) + String(stock ? alpha(stock.pnlPct, stockBench.ret) : '—').padStart(16) + String(crypto ? alpha(crypto.pnlPct, btcBench) : '—').padStart(16));
console.log(line);
console.log('  Trading fees are modeled (PSE ~1.2% round-trip, crypto ~0.5%).');
console.log('  Not financial advice — paper-trading simulation only.\n');
