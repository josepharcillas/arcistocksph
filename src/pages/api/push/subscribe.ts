import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: { endpoint?: string; p256dh?: string; auth?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.endpoint || !body.p256dh || !body.auth) {
    return json({ error: 'endpoint, p256dh and auth are required' }, 400);
  }

  await query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
       values ($1, $2, $3, $4)
     on conflict (user_id, endpoint) do update
       set p256dh = excluded.p256dh, auth = excluded.auth`,
    [user.id, body.endpoint, body.p256dh, body.auth]
  );

  return json({ ok: true });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
