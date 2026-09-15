import type { APIRoute } from 'astro';
import { setCash } from '../../../lib/repo';

export const prerender = false;

/** Set the real-portfolio cash balance (powers Total Account Equity). */
export const PUT: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const cash = Number(body.cash);
  if (!Number.isFinite(cash) || cash < 0) {
    return json({ error: 'Cash must be zero or more.' }, 400);
  }

  try {
    await setCash(user.id, cash);
    return json({ ok: true, cash });
  } catch (err) {
    console.error('[api/portfolio/cash] PUT failed:', err);
    return json({ error: 'Could not save your cash balance.' }, 503);
  }
};

export const POST = PUT;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
