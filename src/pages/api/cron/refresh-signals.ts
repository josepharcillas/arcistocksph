import type { APIRoute } from 'astro';
import { refreshSignals } from '../../../lib/refreshSignals';

// POST wrapper around the shared refresh pipeline (src/lib/refreshSignals.ts —
// five rings: holdings + watchlists + top-active + liquid-stock rotation +
// crypto rotation). The in-process scheduler also runs it directly; this
// endpoint exists for external crons and manual pokes.
// ?topActive=N&rotate=N&cryptoTop=N override ring sizes (defaults 30/30/15).
//   */30 1-8 * * 1-5  curl -fsS -X POST \
//     -H "Authorization: Bearer $PUSH_NOTIFY_SECRET" \
//     -H "Content-Type: application/json" \
//     https://YOUR_DOMAIN/api/cron/refresh-signals
// (01:30–07:30 UTC ≈ PSE trading hours in PHT, Mon–Fri.)
// The application/json header is required — Astro's CSRF guard rejects POSTs
// with a form content-type and no matching Origin (i.e. server-to-server calls).

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

export const POST: APIRoute = async ({ request, url }) => {
  const secret = env('PUSH_NOTIFY_SECRET');
  if (!secret) return json({ error: 'PUSH_NOTIFY_SECRET not configured' }, 500);
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401);

  try {
    const num = (k: string, d: number) => Math.max(0, Number(url.searchParams.get(k) ?? d));
    return json(await refreshSignals({
      topActive: num('topActive', 30), rotate: num('rotate', 30), cryptoTop: num('cryptoTop', 15),
    }));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
