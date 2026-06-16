import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabase-server';
import { rateLimit } from './lib/rateLimit';

const PROTECTED = ['/dashboard', '/api/analyze', '/api/signals'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, cookies, redirect, locals, url } = context;

  // Rate-limit API routes by client IP. AI endpoints get a tighter budget.
  if (url.pathname.startsWith('/api/')) {
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

  const isProtected = PROTECTED.some((p) => url.pathname.startsWith(p));
  if (!isProtected) return next();

  const supabase = createSupabaseServerClient(request, cookies);
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return redirect('/login');

  locals.user = user;
  return next();
});
