// TASK-063: smoke-test the real data + AI pipeline against live PSE tickers,
// through the authenticated HTTP path. Logs in as the demo user via Playwright
// (so the auth cookie + same-origin CSRF are real), then for each ticker fetches
// market data and generates an AI signal from within the page context.
//
// Needs: local Supabase + a running server (BASE_URL) with an AI key + the demo
// user seeded. Usage: BASE_URL=http://127.0.0.1:4321 node scripts/smoke-tickers.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:4321';
const TICKERS = (process.env.TICKERS || 'SM,BDO,AC,TEL,JFC').split(',');

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', 'demo@arcistocks.local');
await page.fill('#password', 'demo123456');
await page.click('#email-submit');
await page.waitForURL('**/dashboard', { timeout: 10000 });

let failures = 0;

for (const ticker of TICKERS) {
  console.log(`\n${ticker}`);
  try {
    const result = await page.evaluate(async (t) => {
      const dRes = await fetch(`/api/stock/${t}`);
      const data = await dRes.json();
      if (!dRes.ok) throw new Error(`data ${dRes.status}: ${data.error}`);
      const sRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: t, companyName: data.companyName }),
      });
      const sig = await sRes.json();
      if (!sRes.ok) throw new Error(`signal ${sRes.status}: ${sig.error}`);
      return { data, sig };
    }, ticker);

    const tech = result.data.technicals;
    console.log(`  data    : price ₱${tech?.currentPrice ?? '?'} | RSI ${tech?.rsi14?.toFixed?.(1) ?? '?'} | SMA20 ₱${tech?.sma20?.toFixed?.(2) ?? '?'} | headlines ${result.data.headlines?.length ?? 0}`);
    if (tech?.currentPrice == null || !tech.currentPrice) throw new Error('no live price (invalid ticker?)');
    if (!['BUY', 'SELL', 'HOLD'].includes(result.sig.verdict)) throw new Error(`bad verdict: ${result.sig.verdict}`);
    console.log(`  signal  : ${result.sig.verdict} (${result.sig.confidence}) via ${result.sig.provider}${result.sig.cached ? ' [cached]' : ''}`);
    console.log('  PASS');
  } catch (err) {
    failures++;
    console.log(`  FAIL    : ${err instanceof Error ? err.message : err}`);
  }
}

await browser.close();
console.log(`\n${failures === 0 ? 'SMOKE: ALL PASSED' : `SMOKE: ${failures}/${TICKERS.length} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
