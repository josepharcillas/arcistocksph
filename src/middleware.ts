import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabase-server';

const PROTECTED = ['/dashboard', '/api/analyze', '/api/signals'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, cookies, redirect, locals, url } = context;
  const isProtected = PROTECTED.some((p) => url.pathname.startsWith(p));
  if (!isProtected) return next();

  const supabase = createSupabaseServerClient(request, cookies);
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return redirect('/login');

  locals.user = user;
  return next();
});
