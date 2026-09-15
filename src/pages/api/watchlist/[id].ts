import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';

export const prerender = false;

const ALERT_FIELDS = new Set(['alert_price_above', 'alert_price_below']);

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);
  const id = params.id;
  if (!id) return json({ error: 'id is required' }, 400);

  let body: { field?: string; value?: number | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.field || !ALERT_FIELDS.has(body.field)) {
    return json({ error: 'field must be alert_price_above or alert_price_below' }, 400);
  }

  // field name is validated against a fixed allowlist above, so this is safe to interpolate.
  await query(
    `update watchlist set ${body.field} = $1 where id = $2 and user_id = $3`,
    [body.value ?? null, id, user.id]
  );
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);
  const id = params.id;
  if (!id) return json({ error: 'id is required' }, 400);

  await query(`delete from watchlist where id = $1 and user_id = $2`, [id, user.id]);
  return json({ ok: true });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
