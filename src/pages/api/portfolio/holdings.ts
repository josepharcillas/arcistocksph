import type { APIRoute } from 'astro';
import { addHolding, deleteHolding } from '../../../lib/repo';

export const prerender = false;

const today = () => new Date().toISOString().split('T')[0];

/** Add shares, averaging into an existing position for the same ticker. */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const ticker = String(body.ticker ?? '').trim().toUpperCase();
  const qty = Number(body.qty);
  const buyPrice = Number(body.buyPrice ?? body.buy_price);
  const buyDate = String(body.buyDate ?? body.buy_date ?? today());

  // Validate here, not just in the form: this endpoint is reachable directly,
  // and the schema's CHECK constraints would surface as a 500 rather than a
  // message the user can act on.
  if (!ticker) return json({ error: 'A ticker is required.' }, 400);
  if (!Number.isFinite(qty) || qty <= 0) return json({ error: 'Quantity must be greater than zero.' }, 400);
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return json({ error: 'Buy price must be greater than zero.' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(buyDate)) return json({ error: 'Buy date must be YYYY-MM-DD.' }, 400);

  try {
    await addHolding(user.id, {
      ticker,
      companyName: typeof body.companyName === 'string' ? body.companyName : null,
      qty,
      buyPrice,
      buyDate,
    });
    return json({ ok: true });
  } catch (err) {
    console.error('[api/portfolio/holdings] POST failed:', err);
    return json({ error: 'Could not save that holding.' }, 503);
  }
};

/** Remove one position. Scoped to the signed-in user by the query itself. */
export const DELETE: APIRoute = async ({ url, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'An id is required.' }, 400);

  try {
    await deleteHolding(user.id, id);
    return json({ ok: true });
  } catch (err) {
    console.error('[api/portfolio/holdings] DELETE failed:', err);
    return json({ error: 'Could not remove that holding.' }, 503);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
