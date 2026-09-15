import type { APIRoute } from 'astro';
import { listHoldings, getCash } from '../../../lib/repo';

export const prerender = false;

/** The whole portfolio in one round trip: positions plus the cash balance. */
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  try {
    const [holdings, cash] = await Promise.all([listHoldings(user.id), getCash(user.id)]);
    return json({ holdings, cash, userId: user.id });
  } catch (err) {
    console.error('[api/portfolio] GET failed:', err);
    return json({ error: 'Could not load your portfolio.' }, 503);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
