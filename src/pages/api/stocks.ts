import type { APIRoute } from 'astro';
import { fetchAllQuotes } from '../../lib/market';

// Whole-market snapshot for the screener. phisix returns ~385 stocks in one call;
// cache 15 min (PSE data is delayed anyway).
let cache: { data: unknown; expiresAt: number } | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

export const GET: APIRoute = async () => {
  if (cache && cache.expiresAt > Date.now()) {
    return new Response(JSON.stringify(cache.data), { headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const map = await fetchAllQuotes();
    const data = [...map.values()];
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
