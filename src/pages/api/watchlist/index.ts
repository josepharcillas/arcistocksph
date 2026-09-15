import type { APIRoute } from 'astro';
import { query, queryOne } from '../../../lib/db';

export const prerender = false;

interface WatchItem {
  id: string;
  ticker: string;
  company_name: string | null;
  alert_price_above: number | null;
  alert_price_below: number | null;
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  const rows = await query<WatchItem>(
    `select id, ticker, company_name, alert_price_above, alert_price_below
       from watchlist where user_id = $1 order by created_at desc`,
    [user.id]
  );
  return json(rows);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: { ticker?: string; companyName?: string | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const ticker = body.ticker?.toUpperCase().replace('.PS', '').trim();
  if (!ticker) return json({ error: 'ticker is required' }, 400);

  try {
    const row = await queryOne<WatchItem>(
      `insert into watchlist (user_id, ticker, company_name)
         values ($1, $2, $3)
       returning id, ticker, company_name, alert_price_above, alert_price_below`,
      [user.id, ticker, body.companyName ?? null]
    );
    return json(row, 201);
  } catch (err: any) {
    if (err?.code === '23505') return json({ error: `${ticker} is already on your watchlist.` }, 409);
    console.error('[api/watchlist] POST failed:', err);
    return json({ error: 'Could not add to watchlist.' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
