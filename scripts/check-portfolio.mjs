import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4344';
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', 'demo@arcistocks.local');
await page.fill('#password', 'demo123456');
await page.click('#email-submit');
await page.waitForURL('**/dashboard', { timeout: 10000 });
await page.waitForTimeout(1500);

const hasEquity = await page.isVisible('text=Total Account Equity');
console.log('equity card        :', hasEquity);

// edit cash -> 50000
await page.click('button:has-text("edit")');
const input = page.locator('input[type=number]').first();
await input.fill('50000');
await page.click('button:has-text("✓")');
await page.waitForTimeout(1500);

// reload and confirm persisted
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const body = await page.textContent('body');
console.log('cash persisted 50k :', body.includes('50,000'));
console.log('shows weight/book  :', body.includes('of book'));

// paper trading adjust
await page.goto(`${BASE}/dashboard/paper-trading`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const hasAdjust = await page.isVisible('button:has-text("adjust")');
console.log('paper adjust button:', hasAdjust);

console.log('page errors        :', errs.length ? errs.map(e=>e.split(';')[0]) : '(none)');
await browser.close();
