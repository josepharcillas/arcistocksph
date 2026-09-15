// Repairs the DCA bot account after the 2026-07-06 concurrent-run corruption.
//
// On 2026-07-06 the scheduler had accumulated 23 duplicate DCA cron
// registrations (module-level `started` guard reset by Vite dev SSR reloads
// while the previously registered node-cron jobs kept running). All 23 fired at
// 02:15 UTC and raced each other's read-modify-write of portfolio_cash, so:
//   * cash kept 22 runs' worth of spending it had actually spent (₱9,051 phantom)
//   * BTC took the update-by-ticker path and the racing writes clobbered each
//     other, leaving ~8% of the BTC the bot actually paid for
//   * BPI took the insert path 23 times, fragmenting one position into 23 rows
//
// paper_trades is the one record the race did not damage (every run appended,
// none overwrote), so we rebuild cash and positions by replaying it.
//
//   node scripts/repair-dca.mjs          # dry run — prints the diff, writes nothing
//   node scripts/repair-dca.mjs --apply  # write the corrections
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EMAIL = 'dca-bot@arcistocks.local';
const STARTING_CASH = 10000;
const APPLY = process.argv.includes('--apply');

const admin = createClient(URL, SERVICE);
const peso = (n) => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const { data: users } = await admin.auth.admin.listUsers();
const bot = users.users.find((u) => u.email === EMAIL);
if (!bot) throw new Error(`${EMAIL} not found`);

// --- Replay the trade log: the source of truth ---
const { data: trades } = await admin
  .from('paper_trades').select('ticker, action, qty, price, traded_at')
  .eq('user_id', bot.id).order('traded_at');

let cash = STARTING_CASH;
const book = new Map(); // ticker -> { qty, cost }
for (const t of trades ?? []) {
  const qty = Number(t.qty), value = qty * Number(t.price);
  const pos = book.get(t.ticker) ?? { qty: 0, cost: 0 };
  if (t.action === 'BUY') {
    cash -= value; pos.qty += qty; pos.cost += value;
  } else {
    const avg = pos.qty > 0 ? pos.cost / pos.qty : Number(t.price);
    cash += value; pos.qty -= qty; pos.cost -= avg * qty;
  }
  book.set(t.ticker, pos);
}
for (const [t, p] of book) if (p.qty <= 1e-12) book.delete(t);

// Dividends credited to cash are logged in dca_dividend_credits, not in
// paper_trades — replay them too or the rebuild would erase that income.
const { data: credits } = await admin
  .from('dca_dividend_credits').select('pesos').eq('user_id', bot.id);
const dividendIncome = (credits ?? []).reduce((s, c) => s + Number(c.pesos ?? 0), 0);
cash += dividendIncome;

// --- Compare against stored state ---
const { data: cashRow } = await admin
  .from('portfolio_cash').select('cash').eq('user_id', bot.id).maybeSingle();
const { data: rows } = await admin
  .from('holdings').select('id, ticker, qty, buy_price').eq('user_id', bot.id);

const storedCash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
console.log(`\n  ${trades?.length ?? 0} trades replayed · ${credits?.length ?? 0} dividend credit(s) (${peso(dividendIncome)})\n`);
console.log('  CASH');
console.log(`    stored     ${peso(storedCash)}`);
console.log(`    rebuilt    ${peso(cash)}`);
console.log(`    correction ${peso(cash - storedCash)}\n`);

console.log('  POSITIONS                stored            rebuilt');
const tickers = [...new Set([...rows.map((r) => r.ticker), ...book.keys()])].sort();
for (const t of tickers) {
  const mine = rows.filter((r) => r.ticker === t);
  const storedQty = mine.reduce((s, r) => s + Number(r.qty), 0);
  const want = book.get(t);
  const dup = mine.length > 1 ? `  (${mine.length} duplicate rows -> 1)` : '';
  console.log(`    ${t.padEnd(8)} ${String(storedQty).padStart(18)} ${String(want ? want.qty : 0).padStart(18)}${dup}`);
}

if (!APPLY) {
  console.log('\n  DRY RUN — nothing written. Re-run with --apply to commit.\n');
  process.exit(0);
}

// --- Apply: collapse each ticker to one row carrying the replayed qty/avg ---
for (const t of tickers) {
  const mine = rows.filter((r) => r.ticker === t);
  const want = book.get(t);
  if (!want) {
    for (const r of mine) await admin.from('holdings').delete().eq('id', r.id);
    continue;
  }
  const [keep, ...extra] = mine;
  const avg = want.cost / want.qty;
  if (keep) {
    await admin.from('holdings').update({ qty: want.qty, buy_price: avg }).eq('id', keep.id);
    for (const r of extra) await admin.from('holdings').delete().eq('id', r.id);
  } else {
    await admin.from('holdings').insert({
      user_id: bot.id, ticker: t, company_name: t, qty: want.qty, buy_price: avg,
      buy_date: new Date().toISOString().slice(0, 10),
    });
  }
}
await admin.from('portfolio_cash').upsert(
  { user_id: bot.id, cash, updated_at: new Date().toISOString() }, { onConflict: 'user_id' },
);

console.log('\n  APPLIED — cash and positions rebuilt from the trade log.\n');
