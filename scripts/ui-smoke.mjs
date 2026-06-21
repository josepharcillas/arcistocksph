// CI-friendly real-browser smoke test. Needs only a running web server
// (BASE_URL) — no Supabase, no AI keys. It guards the regression class behind
// the "submit just refreshes the page" bug: a client script that throws on load
// (e.g. a bad Supabase import) detaches the form handler, so the form falls back
// to a native GET submit and reloads the page with ?email=... query params.
//
// Usage: BASE_URL=http://127.0.0.1:4321 node scripts/ui-smoke.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:4321';
const browser = await chromium.launch();
const failures = [];

async function newPage() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  return { page, errors };
}

// Retry goto so the test tolerates a server still warming up in CI.
async function goto(page, url) {
  let lastErr;
  for (let i = 0; i < 10; i++) {
    try { return await page.goto(url, { waitUntil: 'networkidle', timeout: 5000 }); }
    catch (e) { lastErr = e; await page.waitForTimeout(1000); }
  }
  throw lastErr;
}

function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name} ${detail}`); failures.push(name); }
}

// 1) Public pages load without JS errors
for (const path of ['/', '/login']) {
  const { page, errors } = await newPage();
  const res = await goto(page, `${BASE}${path}`);
  check(`${path} returns 2xx`, res && res.ok(), `(status ${res?.status()})`);
  check(`${path} loads with no JS errors`, errors.length === 0, errors.join(' | '));
  await page.close();
}

// 2) THE regression guard: the login submit handler must be attached.
{
  const { page } = await newPage();
  await goto(page, `${BASE}/login`);
  await page.fill('#email', 'smoke@example.com');
  await page.fill('#password', 'whatever123');
  await page.click('#email-submit');
  await page.waitForTimeout(2000);
  const url = page.url();
  // If the handler is attached it calls preventDefault — the URL never gains
  // a ?email= query string. If it detached, the native submit reloads with it.
  check('login submit handler is attached (no native page reload)',
    !url.includes('email=smoke'), `(url became ${url})`);
  await page.close();
}

await browser.close();
console.log('');
if (failures.length) { console.log(`UI SMOKE: FAILED (${failures.length})`); process.exit(1); }
console.log('UI SMOKE: ALL PASSED');
