import type { APIRoute } from 'astro';
import { analyzeStock } from '../../lib/ai';
import { getStockData } from '../../lib/market';

// Simple in-memory cache (resets on cold start — good enough for serverless)
const cache = new Map<string, { result: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export const POST: APIRoute = async ({ request }) => {
  try {
    const { ticker, companyName } = await request.json();
    if (!ticker) return new Response(JSON.stringify({ error: 'ticker is required' }), { status: 400 });

    const cacheKey = ticker.toUpperCase();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return new Response(JSON.stringify({ ...cached.result, cached: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stockData = await getStockData(ticker.toUpperCase(), companyName ?? ticker);
    const result = await analyzeStock(stockData);

    cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
