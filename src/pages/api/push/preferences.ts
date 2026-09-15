import type { APIRoute } from 'astro';
import { query } from '../../../lib/db';

export const prerender = false;

/** Tickers the user holds, decorated with whether push alerts are on for each. */
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  const [holdings, prefs] = await Promise.all([
    query<{ ticker: string }>(`select distinct ticker from holdings where user_id = $1`, [user.id]),
    query<{ ticker: string; enabled: boolean }>(
      `select ticker, enabled from push_preferences where user_id = $1`,
      [user.id]
    ),
  ]);
  const off = new Set(prefs.filter((p) => p.enabled === false).map((p) => p.ticker));
  const stocks = holdings.map((h) => ({ ticker: h.ticker, enabled: !off.has(h.ticker) }));

  return json({ stocks });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: { ticker?: string; enabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.ticker || typeof body.enabled !== 'boolean') {
    return json({ error: 'ticker and enabled are required' }, 400);
  }

  await query(
    `insert into push_preferences (user_id, ticker, enabled)
       values ($1, $2, $3)
     on conflict (user_id, ticker) do update set enabled = excluded.enabled`,
    [user.id, body.ticker, body.enabled]
  );

  return json({ ok: true });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
