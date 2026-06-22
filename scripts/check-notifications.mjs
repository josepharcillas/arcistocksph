import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://localhost:4321';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', 'demo@arcistocks.local');
await page.fill('#password', 'demo123456');
await page.click('#email-submit');
await page.waitForURL('**/dashboard', { timeout: 10000 });

await page.goto(`${BASE}/dashboard/notifications`, { waitUntil: 'networkidle' });
const heading = await page.textContent('h1');
const hasCard = await page.isVisible('text=Push notifications');
const hasPerStock = await page.isVisible('text=Per-stock alerts');

console.log('heading           :', heading?.trim());
console.log('push card visible :', hasCard);
console.log('per-stock visible :', hasPerStock);
console.log('page errors       :', errors.length ? errors : '(none)');

await browser.close();
const ok = hasCard && hasPerStock && errors.length === 0;
console.log(ok ? '\nNOTIFICATIONS PAGE: OK' : '\nNOTIFICATIONS PAGE: FAILED');
process.exit(ok ? 0 : 1);
