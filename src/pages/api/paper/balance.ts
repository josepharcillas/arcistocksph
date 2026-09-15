import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';

export const prerender = false;

/** Manual balance adjustment ("adjust" / "reset to ₱100k" in the UI). */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: { balance?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const balance = Number(body.balance);
  if (!Number.isFinite(balance) || balance < 0) return json({ error: 'balance must be a non-negative number' }, 400);

  await query(
    `insert into paper_balances (user_id, balance, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set balance = excluded.balance, updated_at = now()`,
    [user.id, balance]
  );
  return json({ ok: true, balance });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
