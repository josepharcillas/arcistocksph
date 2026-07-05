// One-glance scoreboard: STOCK bot vs CRYPTO bot, each vs a buy-and-hold benchmark.
// Benchmarks answer "does the bot beat just holding?": crypto vs BTC hold (since the
// bot started), stocks vs an equal-weight PSEi-30 basket (baseline tracked forward).
// Standalone — reads local Supabase + live prices directly (no server needed).
//
//   node scripts/scoreboard.mjs
import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { winRateReplay, alpha, basketReturn } from './lib/botStats.mjs';

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
    const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=php&order=market_cap_desc&per_page=250&page=1', { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
  const { closed, realized, winRate } = winRateReplay(trades);
  return {
    cash, equity, positions: (holdings ?? []).length, trades: (trades ?? []).length,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    closed, winRate, realized,
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
  const ret = basketReturn(data.stock.prices, sp);
  return { ret, since: data.stock.date };
}

const [sp, cp] = await Promise.all([stockPrices(), cryptoPrices()]);
const merged = new Map([...sp, ...cp]); // DCA bot holds both asset types
const [stock, crypto, dca] = await Promise.all([
  summarize('bot@arcistocks.local', sp),
  summarize('crypto-bot@arcistocks.local', cp),
  summarize('dca-bot@arcistocks.local', merged),
]);
const [btcBench, stockBench] = await Promise.all([
  btcReturnSince(crypto?.startDate),
  stockBasketReturn(sp),
]);

const cols = [stock, crypto, dca];
const row = (label, fn) => '  ' + String(label).padEnd(18) + cols.map((c) => String(c ? fn(c) : '—').padStart(14)).join('');
const line = '─'.repeat(62);
console.log('\n' + line);
console.log('  🏆 ARCISTOCKS BOT SCOREBOARD   ' + new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }));
console.log(line);
console.log('  ' + ''.padEnd(18) + 'AI STOCKS'.padStart(14) + 'AI CRYPTO'.padStart(14) + 'DCA 🐢'.padStart(14));
console.log(line);
console.log(row('Equity', (s) => peso(s.equity)));
console.log(row('Bot return', (s) => pct(s.pnlPct)));
console.log(row('Cash', (s) => peso(s.cash)));
console.log(row('Open positions', (s) => s.positions));
console.log(row('Trades', (s) => s.trades));
console.log(row('Win rate', (s) => (s.winRate == null ? '—' : s.winRate.toFixed(0) + '%')));
console.log(row('Realized P/L', (s) => peso(s.realized)));
console.log(line);
console.log('  BUY & HOLD BENCHMARK (do the bots beat just holding?)');
console.log('  ' + 'Benchmark'.padEnd(18) + ('PSEi-30 ' + pct(stockBench.ret)).padStart(14) + ('BTC ' + pct(btcBench)).padStart(14));
const alphaCell = (botPnl, bench) => { const a = alpha(botPnl, bench); return a == null ? '—' : pct(a); };
console.log('  ' + 'Bot vs benchmark'.padEnd(18) + String(stock ? alphaCell(stock.pnlPct, stockBench.ret) : '—').padStart(14) + String(crypto ? alphaCell(crypto.pnlPct, btcBench) : '—').padStart(14));
console.log(line);
console.log('  Fees modeled: PSE ~0.7% round-trip (post-CMEPA), crypto ~0.5%.');
console.log('  DCA bot: weekly buys of dividend blue chips + BTC; cash dividends');
console.log('  ARE credited from scraped PSE Edge disclosures.');
console.log('  Not financial advice — paper-trading simulation only.\n');
