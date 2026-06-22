import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4350';
const browser = await chromium.launch();
const page = await browser.newPage();
let curErrors = [];
page.on('pageerror', e => curErrors.push('PAGEERR: ' + e.message.split('\n')[0]));
page.on('console', m => { if (m.type()==='error') curErrors.push('console: ' + m.text().split('\n')[0]); });
page.on('requestfailed', r => curErrors.push('reqfail: ' + r.url().split('?')[0] + ' ' + (r.failure()?.errorText||'')));

async function visit(label, path, wait=2500) {
  curErrors = [];
  let status = '?';
  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 15000 });
    status = res?.status();
    await page.waitForTimeout(wait);
  } catch (e) { curErrors.push('NAV: ' + e.message.split('\n')[0]); }
  const errs = [...new Set(curErrors)];
  console.log(`${errs.length?'❌':'✅'} [${status}] ${label} (${path})${errs.length?'\n   '+errs.join('\n   '):''}`);
}

// login
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email','demo@arcistocks.local'); await page.fill('#password','demo123456');
await page.click('#email-submit');
try { await page.waitForURL('**/dashboard',{timeout:10000}); console.log('✅ login OK'); }
catch { console.log('❌ login FAILED — did not reach /dashboard'); }

await visit('Portfolio','/dashboard');
await visit('Signals','/dashboard/signals');
await visit('Screener','/screener', 4000);
await visit('Watchlist','/dashboard/watchlist');
await visit('Paper Trading','/dashboard/paper-trading');
await visit('Leaderboard','/leaderboard');
await visit('Notifications','/dashboard/notifications');
await visit('Stock detail','/stock/SM', 4000);
await visit('Disclaimer','/disclaimer');
await browser.close();
