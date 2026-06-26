// Seeds the autonomous paper-trading bot account on local Supabase.
// The bot starts with ₱10,000 and no holdings; the auto-trade cron grows it from
// the AI advisor's own suggestions. Safe to re-run (won't touch cash unless --reset).
//
//   node scripts/seed-bot.mjs            # create bot if missing, leave money as-is
//   node scripts/seed-bot.mjs --reset    # wipe holdings/trades/snapshots, reset to ₱10,000
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const EMAIL = 'bot@arcistocks.local';
const PASSWORD = 'botbot123456';
const STARTING_CASH = 10000;
const reset = process.argv.includes('--reset');

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

// Find or create the bot auth user.
const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
let user = list?.users?.find((u) => u.email === EMAIL);
if (!user) {
  const { data: created, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (error) { console.error('createUser failed:', error.message); process.exit(1); }
  user = created.user;
  console.log('created bot user', user.id);
} else {
  console.log('bot user exists', user.id);
}
const uid = user.id;

if (reset) {
  await admin.from('holdings').delete().eq('user_id', uid);
  await admin.from('paper_trades').delete().eq('user_id', uid);
  await admin.from('balance_snapshots').delete().eq('user_id', uid);
  console.log('reset: cleared holdings, trades, snapshots');
}

// Set cash only on first creation or --reset, so re-running never clobbers progress.
const { data: existingCash } = await admin.from('portfolio_cash').select('cash').eq('user_id', uid).maybeSingle();
if (reset || !existingCash) {
  await admin.from('portfolio_cash').upsert({ user_id: uid, cash: STARTING_CASH, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  console.log(`set cash to ₱${STARTING_CASH.toLocaleString()}`);
} else {
  console.log(`cash left as-is: ₱${Number(existingCash.cash).toLocaleString()}`);
}

// Keep the bot out of the human leaderboard; give it a recognisable name.
await admin.from('profiles').update({ display_name: '🤖 AI Auto-Trader', leaderboard_opt_in: false }).eq('id', uid);

console.log('\n========================================');
console.log('  BOT LOGIN:  ' + EMAIL);
console.log('  PASS     :  ' + PASSWORD);
console.log('  Watch it grow: log in, or GET /api/cron/auto-trade');
console.log('========================================');
