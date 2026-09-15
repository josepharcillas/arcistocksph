import type { APIRoute } from 'astro';
import { syncHoldings, type SyncPosition } from '../../../lib/repo';

export const prerender = false;

/**
 * Replace the portfolio to match a reviewed broker import.
 *
 * The client used to apply this as a series of individual writes, which could
 * leave a half-synced portfolio behind if the tab closed mid-loop. One
 * transaction here means the import either lands whole or not at all.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const raw = Array.isArray(body.positions) ? body.positions : null;
  if (!raw) return json({ error: 'No positions were sent.' }, 400);

  const positions: SyncPosition[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    const ticker = String(p.ticker ?? '').trim().toUpperCase();
    const qty = Number(p.qty ?? p.shares);
    const buyPrice = Number(p.buyPrice ?? p.avgPrice ?? p.buy_price);
    if (!ticker) return json({ error: 'A position is missing its ticker.' }, 400);
    if (!Number.isFinite(qty) || qty <= 0) return json({ error: `${ticker}: shares must be greater than zero.` }, 400);
    if (!Number.isFinite(buyPrice) || buyPrice <= 0) return json({ error: `${ticker}: average price must be greater than zero.` }, 400);
    positions.push({ ticker, qty, buyPrice });
  }

  const keep = Array.isArray(body.keep) ? body.keep.map((t) => String(t)) : [];
  const cash = body.cash === null || body.cash === undefined ? null : Number(body.cash);
  if (cash !== null && (!Number.isFinite(cash) || cash < 0)) {
    return json({ error: 'Cash must be zero or more.' }, 400);
  }

  try {
    const result = await syncHoldings(user.id, positions, keep, cash);
    return json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/portfolio/sync] POST failed:', err);
    return json({ error: 'Could not save the imported portfolio.' }, 503);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
