import type { APIRoute } from 'astro';
import { createSupabaseAdmin } from '../../lib/supabase-admin';
import { computeStandings, START_BALANCE } from '../../lib/leaderboard';

const CACHE_TTL_MS = 5 * 60 * 1000;
const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30 };

// period -> cached payload
const cache = new Map<string, { data: unknown; expiresAt: number }>();

export const GET: APIRoute = async ({ url }) => {
  const period = url.searchParams.get('period') ?? 'all';
  const days = PERIOD_DAYS[period]; // undefined for 'all'

  const hit = cache.get(period);
  if (hit && hit.expiresAt > Date.now()) {
    return new Response(JSON.stringify(hit.data), { headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const admin = createSupabaseAdmin();
    const standings = await computeStandings(admin);

    // Baseline per user: ₱100k for all-time; for week/month it's the earliest
    // balance snapshot within the window (falls back to ₱100k until snapshots accrue).
    const baselineByUser = new Map<string, number>();
    if (days != null) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const { data: snaps } = await admin
        .from('balance_snapshots')
        .select('user_id, snapshot_date, total_value')
        .gte('snapshot_date', since)
        .order('snapshot_date', { ascending: true });
      for (const s of snaps ?? []) {
        if (!baselineByUser.has(s.user_id)) baselineByUser.set(s.user_id, Number(s.total_value));
      }
    }

    const rows = standings
      .map((s) => {
        const baseline = days != null ? (baselineByUser.get(s.userId) ?? START_BALANCE) : START_BALANCE;
        return {
          name: s.name,
          returnPct: baseline > 0 ? (s.total / baseline - 1) * 100 : 0,
          totalValue: s.total,
        };
      })
      .sort((a, b) => b.returnPct - a.returnPct)
      .map((r, i) => ({ rank: i + 1, ...r }));

    cache.set(period, { data: rows, expiresAt: Date.now() + CACHE_TTL_MS });
    return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
