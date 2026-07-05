import type { APIRoute } from 'astro';
import { getDividendBoard } from '../../lib/dividends';

// Public read: ranked TTM dividend yields + entry ratings. ?limit=N (default 50).
export const GET: APIRoute = async ({ url }) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
    const board = await getDividendBoard(limit);
    return new Response(JSON.stringify(board), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};
