import { defineMiddleware } from 'astro:middleware';
import { getSessionUser } from './lib/auth';
import { rateLimit } from './lib/rateLimit';
import { initScheduler } from './lib/scheduler';

/**
 * Routes reachable without a session. Everything under /dashboard and the
 * authenticated APIs sit behind the session cookie; the marketing/read-only
 * pages (/, /screener, /dividends, /leaderboard, /stock/*) stay public as
 * they were.
 */
const PUBLIC_PATHS = new Set([
  '/login',
  '/auth/start',
  '/auth/callback',
  '/api/auth/signout',
  // PayMongo calls this server-to-server and has no session. It is authenticated
  // by HMAC signature inside the route, and must be reachable without a cookie.
  '/api/billing/webhook',
]);

const PROTECTED = ['/dashboard', '/api/analyze', '/api/signals', '/api/me', '/api/portfolio'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { cookies, redirect, locals, url } = context;

  // Start the in-process auto-trade scheduler once, on the first request the
  // server handles. Idempotent + guarded so it never breaks request handling.
  try { initScheduler(); } catch (err) { console.warn('[scheduler] init failed:', err); }

  // The payment webhook is exempt from rate limiting. PayMongo delivers from
  // its own address range and retries anything that is not 2xx, so a 429 here
  // does not slow an attacker down — it delays a payment we have already taken
  // and turns a burst into a retry storm. The route authenticates every request
  // by HMAC signature instead, which is a far stronger gate than an IP budget.
  const isPaymentWebhook = url.pathname === '/api/billing/webhook';

  // Rate-limit API routes by client IP. AI endpoints get a tighter budget.
  if (url.pathname.startsWith('/api/') && !isPaymentWebhook) {
    let ip = 'unknown';
    try { ip = context.clientAddress; } catch { /* prerender/unknown */ }
    const isAI = url.pathname.startsWith('/api/analyze');
    const { ok, retryAfter } = rateLimit(`${ip}:${isAI ? 'ai' : 'api'}`, isAI ? 10 : 60, 60_000);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again shortly.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
      });
    }
  }

  if (PUBLIC_PATHS.has(url.pathname)) return next();

  // Resolve the session for every request so public pages can also greet a
  // signed-in user; only PROTECTED paths are actually gated on it.
  locals.user = await getSessionUser(cookies);

  const isProtected = PROTECTED.some((p) => url.pathname.startsWith(p));
  if (!isProtected) return next();

  if (!locals.user) {
    // API callers get JSON they can act on; a page navigation gets the login
    // screen, because a fetch-driven UI showing a raw 401 is a dead end.
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not signed in' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return redirect('/login');
  }

  return next();
});
