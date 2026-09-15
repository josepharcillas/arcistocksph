import type { APIRoute } from 'astro';
import { query, queryOne } from '../../../lib/db';

export const prerender = false;

const START_BALANCE = 100000;

interface Trade {
  id: string;
  ticker: string;
  action: 'BUY' | 'SELL';
  qty: number;
  price: number;
  company_name: string | null;
  traded_at: string;
}

/** Balance + full trade log, in one round trip. Creates the ₱100k starting
 *  balance row on first visit. */
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let bal = await queryOne<{ balance: number }>(
    `select balance from paper_balances where user_id = $1`,
    [user.id]
  );
  if (!bal) {
    await query(
      `insert into paper_balances (user_id, balance) values ($1, $2) on conflict (user_id) do nothing`,
      [user.id, START_BALANCE]
    );
    bal = { balance: START_BALANCE };
  }

  const trades = await query<Trade>(
    `select id, ticker, action, qty, price, company_name, traded_at
       from paper_trades where user_id = $1 order by traded_at desc`,
    [user.id]
  );

  return json({ balance: Number(bal.balance), trades });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
