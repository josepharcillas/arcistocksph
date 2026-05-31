import { defineMiddleware } from 'astro:middleware';
import { createClient } from '@supabase/supabase-js';

const PROTECTED = ['/dashboard', '/api/analyze', '/api/signals'];

export const onRequest = defineMiddleware(async ({ request, redirect, locals }, next) => {
  const url = new URL(request.url);
  const isProtected = PROTECTED.some(p => url.pathname.startsWith(p));
  if (!isProtected) return next();

  const supabase = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY
  );

  const cookie = request.headers.get('cookie') ?? '';
  const token = cookie.match(/sb-[^-]+-auth-token=([^;]+)/)?.[1];

  if (!token) return redirect('/login');

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return redirect('/login');

  locals.user = user;
  return next();
});
