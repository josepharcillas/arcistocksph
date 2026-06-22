import type { APIRoute } from 'astro';
import { createSupabaseAdmin } from '../../../lib/supabase-admin';
import { computeStandings } from '../../../lib/leaderboard';

// TASK-053: record each opted-in user's total portfolio value once per day so the
// leaderboard can show week/month returns. Run from cron (after market close):
//   0 9 * * 1-5  curl -fsS -X POST \
//     -H "Authorization: Bearer $PUSH_NOTIFY_SECRET" \
//     -H "Content-Type: application/json" \
//     https://YOUR_DOMAIN/api/cron/snapshot-balances
// (09:00 UTC ≈ 17:00 PHT.) Idempotent: one row per (user, date) — re-running
// overwrites today's value.

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

export const POST: APIRoute = async ({ request }) => {
  const secret = env('PUSH_NOTIFY_SECRET');
  if (!secret) return json({ error: 'PUSH_NOTIFY_SECRET not configured' }, 500);
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Unauthorized' }, 401);

  try {
    const admin = createSupabaseAdmin();
    const standings = await computeStandings(admin);
    const today = new Date().toISOString().slice(0, 10);

    if (standings.length === 0) return json({ ok: true, snapshotted: 0 });

    const { error } = await admin.from('balance_snapshots').upsert(
      standings.map((s) => ({ user_id: s.userId, snapshot_date: today, total_value: s.total })),
      { onConflict: 'user_id,snapshot_date' }
    );
    if (error) throw error;

    return json({ ok: true, date: today, snapshotted: standings.length });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
