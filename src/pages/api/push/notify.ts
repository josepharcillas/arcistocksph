import type { APIRoute } from 'astro';
import { notifyHoldersOfSignal } from '../../../lib/push/send';

// TASK-043: server-to-server trigger. Call this when a SELL (or other) signal is
// generated for a ticker to push-notify every holder who hasn't opted out.
//
// Guarded by a shared secret so it can't be invoked by end users. Intended for a
// cron job / serverless trigger:
//   POST /api/push/notify
//   Authorization: Bearer <PUSH_NOTIFY_SECRET>
//   { "ticker": "SM", "verdict": "SELL", "rationale": "..." }

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

export const POST: APIRoute = async ({ request }) => {
  const secret = env('PUSH_NOTIFY_SECRET');
  if (!secret) return json({ error: 'PUSH_NOTIFY_SECRET not configured' }, 500);

  const auth = request.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401);

  let body: { ticker?: string; verdict?: string; rationale?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const ticker = body.ticker?.toUpperCase().replace('.PS', '');
  if (!ticker || !body.verdict) return json({ error: 'ticker and verdict are required' }, 400);

  try {
    const sent = await notifyHoldersOfSignal(ticker, body.verdict, body.rationale ?? '');
    return json({ ok: true, ticker, sent });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
