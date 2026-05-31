import type { APIRoute } from 'astro';
import { getStockData } from '../../../lib/market';

const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min — matches Yahoo Finance delay

export const GET: APIRoute = async ({ params }) => {
  const ticker = params.ticker?.toUpperCase();
  if (!ticker) return new Response(JSON.stringify({ error: 'ticker required' }), { status: 400 });

  const cached = cache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(JSON.stringify(cached.data), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await getStockData(ticker);
    cache.set(ticker, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
