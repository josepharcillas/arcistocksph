// Prints a performance report for the ₱10k auto-trading bot.
// Standalone: reads local Supabase (service role) + live phisix quotes directly,
// so it works whether or not the dev server is running.
//
//   node scripts/bot-report.mjs
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EMAIL = 'bot@arcistocks.local';
const STARTING_CASH = 10000;

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

async function liveQuotes() {
  for (const host of ['https://phisix-api3.appspot.com', 'https://phisix-api4.appspot.com']) {
    try {
      const r = await fetch(`${host}/stocks.json`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const j = await r.json();
      const m = new Map();
      for (const s of j?.stocks ?? []) m.set(s.symbol, s.price?.amount ?? 0);
      if (m.size) return m;
    } catch { /* next host */ }
  }
  return new Map();
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
  return { ticker: h.ticker, qty: Number(h.qty), avg: Number(h.buy_price), price, value, plPesos: value - cost, plPct: cost > 0 ? ((value - cost) / cost) * 100 : 0 };
}).sort((a, b) => b.value - a.value);

const holdingsValue = hs.reduce((s, h) => s + h.value, 0);
const equity = cash + holdingsValue;
const totalPl = equity - STARTING_CASH;
const totalPlPct = (totalPl / STARTING_CASH) * 100;

const line = '─'.repeat(72);
console.log('\n' + line);
console.log('  🤖 ARCISTOCKS AI AUTO-TRADER — PERFORMANCE REPORT');
console.log('  as of ' + new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }));
console.log(line);

console.log('  ACCOUNT');
console.log('    Starting capital   ' + padL(peso(STARTING_CASH), 16));
console.log('    Cash               ' + padL(peso(cash), 16));
console.log('    Holdings value     ' + padL(peso(holdingsValue), 16));
console.log('    ─────────────────  ' + padL('', 16).replace(/ /g, ''));
console.log('    Total equity       ' + padL(peso(equity), 16));
console.log('    Total P/L          ' + padL(peso(totalPl), 16) + '   (' + pct(totalPlPct) + ')');

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
    console.log('    ' + pad(when, 9) + pad(tag, 6) + pad(t.ticker, 8) + padL(t.qty + ' @ ' + peso(t.price), 22) + padL('= ' + peso(t.total), 16));
  }
  if (trades.length > 25) console.log('    … and ' + (trades.length - 25) + ' more');
}

console.log(line);
console.log('  Not financial advice — paper-trading simulation only.\n');
