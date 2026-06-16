// Full signal end-to-end: sign in as the demo user, then POST to the REAL
// protected /api/analyze route (middleware auth -> getStockData(live PSE) ->
// analyzeStock(Groq) -> verdict). Proves the whole product loop.
import { createServerClient } from '@supabase/ssr';

const SB = 'http://127.0.0.1:54321';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const APP = 'http://localhost:4321';

const jar = new Map();
const browser = createServerClient(SB, ANON, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) },
});
const { error } = await browser.auth.signInWithPassword({ email: 'demo@arcistocks.local', password: 'demo123456' });
if (error) { console.log('sign in failed:', error.message); process.exit(1); }
const cookie = [...jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ');

for (const [ticker, name] of [['SM', 'SM Investments'], ['BDO', 'BDO Unibank'], ['JFC', 'Jollibee Foods']]) {
  const res = await fetch(`${APP}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ticker, companyName: name }),
  });
  if (!res.ok) { console.log(`${ticker}: HTTP ${res.status}`, (await res.text()).slice(0, 120)); continue; }
  const j = await res.json();
  console.log(`\n${ticker} (${name})`);
  console.log(`  verdict: ${j.verdict}  confidence: ${j.confidence}  provider: ${j.provider}`);
  console.log(`  target: ${j.targetPrice}  stop: ${j.stopLoss}`);
  console.log(`  rationale: ${j.rationale}`);
}
console.log('\nSIGNAL E2E: completed');
