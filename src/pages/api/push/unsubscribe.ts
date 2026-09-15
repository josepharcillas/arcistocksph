import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.endpoint) return json({ error: 'endpoint is required' }, 400);

  // Scoped to the signed-in user so one browser can't unsubscribe another's endpoint.
  await query(`delete from push_subscriptions where endpoint = $1 and user_id = $2`, [body.endpoint, user.id]);

  return json({ ok: true });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
