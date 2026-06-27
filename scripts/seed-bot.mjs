// Seeds the autonomous paper-trading bot accounts on local Supabase.
// Two bots, each starting with ₱10,000: a STOCK bot (PSE) and a CRYPTO bot.
// Safe to re-run (won't touch cash unless --reset).
//
//   node scripts/seed-bot.mjs            # create bots if missing, leave money as-is
//   node scripts/seed-bot.mjs --reset    # wipe holdings/trades/snapshots, reset to ₱10,000
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const STARTING_CASH = 10000;
const reset = process.argv.includes('--reset');

const BOTS = [
  { email: 'bot@arcistocks.local', password: 'botbot123456', name: '🤖 AI Auto-Trader (Stocks)' },
  { email: 'crypto-bot@arcistocks.local', password: 'botbot123456', name: '🪙 AI Auto-Trader (Crypto)' },
];

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });

for (const bot of BOTS) {
  let user = list?.users?.find((u) => u.email === bot.email);
  if (!user) {
    const { data: created, error } = await admin.auth.admin.createUser({ email: bot.email, password: bot.password, email_confirm: true });
    if (error) { console.error(`createUser failed for ${bot.email}:`, error.message); process.exit(1); }
    user = created.user;
    console.log('created', bot.email, user.id);
  } else {
    console.log('exists  ', bot.email, user.id);
  }
  const uid = user.id;

  if (reset) {
    await admin.from('holdings').delete().eq('user_id', uid);
    await admin.from('paper_trades').delete().eq('user_id', uid);
    await admin.from('balance_snapshots').delete().eq('user_id', uid);
    console.log('  reset: cleared holdings, trades, snapshots');
  }

  const { data: existingCash } = await admin.from('portfolio_cash').select('cash').eq('user_id', uid).maybeSingle();
  if (reset || !existingCash) {
    await admin.from('portfolio_cash').upsert({ user_id: uid, cash: STARTING_CASH, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    console.log(`  set cash to ₱${STARTING_CASH.toLocaleString()}`);
  } else {
    console.log(`  cash left as-is: ₱${Number(existingCash.cash).toLocaleString()}`);
  }

  await admin.from('profiles').update({ display_name: bot.name, leaderboard_opt_in: false }).eq('id', uid);
}

console.log('\n========================================');
for (const b of BOTS) console.log('  ' + b.email + '  /  ' + b.password);
console.log('  Reports: node scripts/bot-report.mjs [--crypto]');
console.log('========================================');
