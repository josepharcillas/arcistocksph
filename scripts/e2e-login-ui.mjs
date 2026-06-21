// Real-browser login test. Drives the actual /login form with Playwright,
// captures console + page errors + the auth network call, and reports what
// happens when you click "Sign in with email".
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:4321';
const EMAIL = 'demo@arcistocks.local';
const PASSWORD = 'demo123456';

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleMsgs = [];
const pageErrors = [];
const authCalls = [];

page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('response', async (r) => {
  if (r.url().includes('/auth/v1/token')) {
    authCalls.push(`${r.status()} ${r.url()}`);
  }
});

console.log(`→ goto ${BASE}/login`);
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });

await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);

const btnTextBefore = await page.textContent('#email-submit');
console.log(`→ button before click: "${btnTextBefore?.trim()}"`);

console.log('→ clicking submit');
await page.click('#email-submit');

// Wait for either a navigation to /dashboard or an error to surface
let outcome = 'NOTHING HAPPENED';
try {
  await page.waitForURL('**/dashboard', { timeout: 8000 });
  outcome = `NAVIGATED to ${page.url()}`;
} catch {
  const errVisible = await page.isVisible('#email-error');
  const errText = errVisible ? (await page.textContent('#email-error'))?.trim() : null;
  const btnTextAfter = (await page.textContent('#email-submit'))?.trim();
  if (errText) outcome = `ERROR SHOWN: "${errText}"`;
  else outcome = `NO NAV. button now: "${btnTextAfter}", url still ${page.url()}`;
}

console.log('\n========== RESULT ==========');
console.log('outcome     :', outcome);
console.log('auth calls  :', authCalls.length ? authCalls : '(none — request never fired)');
console.log('page errors :', pageErrors.length ? pageErrors : '(none)');
console.log('console     :', consoleMsgs.length ? consoleMsgs : '(none)');
console.log('============================');

await browser.close();
process.exit(outcome.startsWith('NAVIGATED') ? 0 : 1);
