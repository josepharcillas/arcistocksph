import type { APIRoute } from 'astro';
import { getOrComputeSignal } from '../../lib/signals';
import { guard } from '../../lib/billing/access';

export const prerender = false;

/**
 * AI signal for one ticker.
 *
 * Gated on `aiSignals`. This is the endpoint that spends real money on every
 * cache miss, so it is the one the paid tier exists to fund — and the check has
 * to live here rather than in the component that calls it, because anything the
 * browser decides is a decision an unauthenticated caller also gets to make.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const denied = await guard((locals as any).user, 'aiSignals');
  if (denied) return denied;

  try {
    const { ticker, companyName } = await request.json();
    if (!ticker) return new Response(JSON.stringify({ error: 'ticker is required' }), { status: 400 });

    const result = await getOrComputeSignal(ticker, companyName);
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
