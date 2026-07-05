import type { APIRoute } from 'astro';
import { getBounceForTicker } from '../../../lib/bounceBoard';

// Pressure-test one ticker: "is this dip a real bounce setup, or a falling knife?"
// Rate-limited by the shared middleware. GET /api/dip-radar/NIKL
export const GET: APIRoute = async ({ params }) => {
  const ticker = params.ticker?.toUpperCase();
  if (!ticker) return json({ ok: false, error: 'ticker required' }, 400);

  try {
    const result = await getBounceForTicker(ticker);
    return json(result, result.ok ? 200 : 404);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
