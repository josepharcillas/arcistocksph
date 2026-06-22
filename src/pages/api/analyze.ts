import type { APIRoute } from 'astro';
import { getOrComputeSignal } from '../../lib/signals';

export const POST: APIRoute = async ({ request }) => {
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
