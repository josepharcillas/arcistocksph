import type { APIRoute } from 'astro';
import { createSupabaseAdmin } from '../../lib/supabase-admin';
import { fetchAllQuotes } from '../../lib/market';

const START_BALANCE = 100000;
let cache: { data: unknown; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export const GET: APIRoute = async () => {
  if (cache && cache.expiresAt > Date.now()) {
    return new Response(JSON.stringify(cache.data), { headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const admin = createSupabaseAdmin();

    const [{ data: profiles }, { data: balances }, { data: trades }, quotes] = await Promise.all([
      admin.from('profiles').select('id, display_name').eq('leaderboard_opt_in', true),
      admin.from('paper_balances').select('user_id, balance'),
      admin.from('paper_trades').select('user_id, ticker, action, qty, price'),
      fetchAllQuotes().catch(() => new Map()),
    ]);

    const balByUser = new Map((balances ?? []).map((b: any) => [b.user_id, Number(b.balance)]));

    // net position qty per user+ticker from the trade log
    const posByUser = new Map<string, Map<string, number>>();
    for (const t of trades ?? []) {
      const m = posByUser.get(t.user_id) ?? new Map<string, number>();
      m.set(t.ticker, (m.get(t.ticker) ?? 0) + (t.action === 'BUY' ? Number(t.qty) : -Number(t.qty)));
      posByUser.set(t.user_id, m);
    }

    const rows = (profiles ?? [])
      .map((p: any) => {
        const cash = balByUser.get(p.id) ?? START_BALANCE;
        let positionsValue = 0;
        for (const [ticker, qty] of posByUser.get(p.id) ?? []) {
          if (qty > 0) positionsValue += qty * ((quotes as Map<string, any>).get(ticker)?.price ?? 0);
        }
        const total = cash + positionsValue;
        return {
          name: p.display_name || 'Anonymous',
          returnPct: (total / START_BALANCE - 1) * 100,
          totalValue: total,
        };
      })
      .sort((a, b) => b.returnPct - a.returnPct)
      .map((r, i) => ({ rank: i + 1, ...r }));

    cache = { data: rows, expiresAt: Date.now() + CACHE_TTL_MS };
    return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
