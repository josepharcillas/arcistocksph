// End-to-end check against the LOCAL Supabase stack.
// Proves: signup trigger -> profile, RLS-scoped holdings insert WITH user_id
// succeeds, insert WITHOUT user_id is rejected, and reads are user-scoped.
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const email = `e2e_${Date.now()}@example.com`;
const password = 'password123';

// 1. Create a user (fires the handle_new_user trigger -> profiles row)
const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (cErr) { bad(`create user: ${cErr.message}`); process.exit(1); }
ok(`created user ${created.user.id}`);

const { data: profile } = await admin.from('profiles').select('*').eq('id', created.user.id).single();
profile ? ok('signup trigger created a profile row') : bad('no profile row created by trigger');

// 2. Sign in as that user (anon client, RLS enforced)
const user = createClient(URL, ANON, { auth: { persistSession: false } });
const { error: sErr } = await user.auth.signInWithPassword({ email, password });
sErr ? bad(`sign in: ${sErr.message}`) : ok('signed in as test user');

// 3. Insert WITH user_id — should succeed (this is the TASK-064 fix)
const { error: goodErr } = await user.from('holdings').insert({
  user_id: created.user.id, ticker: 'SM', qty: 100, buy_price: 85.5, buy_date: '2026-06-01',
});
goodErr ? bad(`insert with user_id rejected: ${goodErr.message}`) : ok('insert WITH user_id succeeded');

// 4. Insert WITHOUT user_id — should be rejected (the original bug)
const { error: badInsert } = await user.from('holdings').insert({ ticker: 'BDO', qty: 10, buy_price: 100 });
badInsert ? ok('insert WITHOUT user_id correctly rejected (RLS/NOT NULL)') : bad('insert without user_id unexpectedly succeeded');

// 5. Read back — RLS scopes to this user
const { data: rows, error: rErr } = await user.from('holdings').select('*');
if (rErr) bad(`read holdings: ${rErr.message}`);
else (rows.length === 1 && rows[0].ticker === 'SM') ? ok(`read back ${rows.length} holding, scoped to user`) : bad(`unexpected rows: ${JSON.stringify(rows)}`);

// cleanup
await admin.auth.admin.deleteUser(created.user.id);

console.log(failures === 0 ? '\nDB E2E: ALL PASSED' : `\nDB E2E: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
