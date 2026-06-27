import type { APIRoute } from 'astro';
import { runAutoTrade, getBotState, type AssetClass } from '../../../lib/autoTrade';

const asAsset = (v: string | null): AssetClass => (v === 'crypto' ? 'crypto' : 'stock');

// Autonomous ₱10k paper-trading bot. POST runs one trading cycle (signals ->
// advisor -> execute -> snapshot); GET returns the bot's current state + equity
// curve (read-only). Both guarded by PUSH_NOTIFY_SECRET like the other crons.
// The in-process scheduler (src/lib/scheduler.ts) also calls runAutoTrade()
// directly on a daily cron, so the bot grows on its own while the server is up.
//
//   POST /api/cron/auto-trade        (optional ?batch=N to size the signal batch)
//   GET  /api/cron/auto-trade        -> { cash, equity, pnlPct, holdings, equityCurve, recentTrades }
// Both need:  Authorization: Bearer $PUSH_NOTIFY_SECRET  +  Content-Type: application/json

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

function authed(request: Request): boolean {
  const secret = env('PUSH_NOTIFY_SECRET');
  return !!secret && request.headers.get('authorization') === `Bearer ${secret}`;
}

export const POST: APIRoute = async ({ request, url }) => {
  if (!env('PUSH_NOTIFY_SECRET')) return json({ error: 'PUSH_NOTIFY_SECRET not configured' }, 500);
  if (!authed(request)) return json({ error: 'Unauthorized' }, 401);
  try {
    const batch = Number(url.searchParams.get('batch') ?? '') || undefined;
    return json(await runAutoTrade({ assetClass: asAsset(url.searchParams.get('asset')), batchSize: batch }));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

export const GET: APIRoute = async ({ request, url }) => {
  if (!env('PUSH_NOTIFY_SECRET')) return json({ error: 'PUSH_NOTIFY_SECRET not configured' }, 500);
  if (!authed(request)) return json({ error: 'Unauthorized' }, 401);
  try {
    return json(await getBotState(asAsset(url.searchParams.get('asset'))));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
