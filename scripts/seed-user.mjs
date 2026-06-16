// Seeds a local demo account + a couple of holdings so the dashboard has data.
// Local Supabase only. Safe to re-run (deletes + recreates the demo user).
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const EMAIL = 'demo@arcistocks.local';
const PASSWORD = 'demo123456';

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

// remove any existing demo user (clean re-run)
const { data: list } = await admin.auth.admin.listUsers();
const existing = list?.users?.find((u) => u.email === EMAIL);
if (existing) {
  await admin.auth.admin.deleteUser(existing.id);
  console.log('removed existing demo user');
}

const { data: created, error } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
});
if (error) { console.error('createUser failed:', error.message); process.exit(1); }
const uid = created.user.id;
console.log('created demo user', uid);

const { error: hErr } = await admin.from('holdings').insert([
  { user_id: uid, ticker: 'SM', company_name: 'SM Investments', qty: 100, buy_price: 600, buy_date: '2026-01-15' },
  { user_id: uid, ticker: 'BDO', company_name: 'BDO Unibank', qty: 500, buy_price: 110, buy_date: '2026-02-01' },
  { user_id: uid, ticker: 'JFC', company_name: 'Jollibee Foods', qty: 200, buy_price: 150, buy_date: '2026-03-10' },
]);
if (hErr) { console.error('seed holdings failed:', hErr.message); process.exit(1); }

console.log('\n  seeded 3 holdings (SM, BDO, JFC)');
console.log('\n========================================');
console.log('  LOGIN:  ' + EMAIL);
console.log('  PASS :  ' + PASSWORD);
console.log('========================================');
