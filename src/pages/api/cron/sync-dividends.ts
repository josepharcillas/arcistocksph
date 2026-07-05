import type { APIRoute } from 'astro';
import { syncDividends } from '../../../lib/market/dividendDisclosures';

// Pull new cash-dividend disclosures from PSE Edge into the `dividends` table.
// Incremental by default (stops once a page has nothing new); pass
// ?sinceDays=365 for a backfill walk. Guarded like the other cron endpoints:
//   curl -fsS -X POST -H "Authorization: Bearer $PUSH_NOTIFY_SECRET" \
//     -H "Content-Type: application/json" \
//     "http://localhost:4321/api/cron/sync-dividends?sinceDays=365"

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

export const POST: APIRoute = async ({ request, url }) => {
  const secret = env('PUSH_NOTIFY_SECRET');
  if (!secret) return json({ error: 'PUSH_NOTIFY_SECRET not configured' }, 500);
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401);

  try {
    const sinceDays = url.searchParams.get('sinceDays');
    const maxPages = url.searchParams.get('maxPages');
    return json(await syncDividends({
      sinceDays: sinceDays ? Number(sinceDays) : undefined,
      maxPages: maxPages ? Number(maxPages) : undefined,
    }));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
