import type { APIRoute } from 'astro';
import { db, queryOne } from '../../../lib/db';

export const prerender = false;

const START_BALANCE = 100000;

/**
 * Place a paper trade. Price comes from the client (the same live quote the
 * order ticket showed) — this mirrors a broker fill on the price you saw, not
 * a re-fetched server price, matching the app's existing paper-trading model.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: { ticker?: string; companyName?: string | null; action?: 'BUY' | 'SELL'; qty?: number; price?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const ticker = body.ticker?.toUpperCase().replace('.PS', '').trim();
  const qty = Number(body.qty);
  const price = Number(body.price);
  const action = body.action;
  if (!ticker || !action || !(qty > 0) || !(price > 0)) {
    return json({ error: 'ticker, action, qty and price are required' }, 400);
  }

  const client = await db().connect();
  try {
    await client.query('begin');
    const balRow = await client.query(`select balance from paper_balances where user_id = $1 for update`, [user.id]);
    const balance = balRow.rows[0] ? Number(balRow.rows[0].balance) : START_BALANCE;

    const value = qty * price;
    if (action === 'BUY' && value > balance) {
      await client.query('rollback');
      return json({ error: `Insufficient cash. Need ₱${value.toFixed(2)}, have ₱${balance.toFixed(2)}.` }, 400);
    }
    const newBalance = action === 'BUY' ? balance - value : balance + value;

    await client.query(
      `insert into paper_trades (user_id, ticker, company_name, action, qty, price)
         values ($1, $2, $3, $4, $5, $6)`,
      [user.id, ticker, body.companyName ?? null, action, qty, price]
    );
    await client.query(
      `insert into paper_balances (user_id, balance, updated_at) values ($1, $2, now())
         on conflict (user_id) do update set balance = excluded.balance, updated_at = now()`,
      [user.id, newBalance]
    );
    await client.query('commit');
    return json({ ok: true, balance: newBalance });
  } catch (err) {
    await client.query('rollback');
    console.error('[api/paper/trade] failed:', err);
    return json({ error: 'Could not place trade.' }, 500);
  } finally {
    client.release();
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
