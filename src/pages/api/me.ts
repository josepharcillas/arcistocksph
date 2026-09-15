import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Who am I? — the client-side replacement for supabase.auth.getUser().
 *
 * React components used to read the signed-in user straight from the Supabase
 * browser client. There is no client-side auth any more: the session is an
 * httpOnly cookie the browser cannot read, so components ask the server.
 * Middleware has already resolved the session by the time this runs.
 */
export const GET: APIRoute = async ({ locals }) => {
  return new Response(JSON.stringify({ user: locals.user ?? null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
