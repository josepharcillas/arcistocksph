import type { createSupabaseAdmin } from './supabase-admin';
import { fetchAllQuotes } from './market';

export const START_BALANCE = 100000;

export interface Standing {
  userId: string;
  name: string;
  total: number;
}

export interface LbProfile { id: string; display_name: string | null }
export interface LbBalance { user_id: string; balance: number }
export interface LbTrade { user_id: string; ticker: string; action: 'BUY' | 'SELL'; qty: number; price: number }

// Pure aggregation: total portfolio value (cash + live value of open positions)
// per opted-in user. Extracted from the DB fetch so it can be unit-tested.
export function aggregateStandings(
  profiles: LbProfile[],
  balances: LbBalance[],
  trades: LbTrade[],
  quotes: Map<string, { price: number }>
): Standing[] {
  const balByUser = new Map(balances.map((b) => [b.user_id, Number(b.balance)]));

  const posByUser = new Map<string, Map<string, number>>();
  for (const t of trades) {
    const m = posByUser.get(t.user_id) ?? new Map<string, number>();
    m.set(t.ticker, (m.get(t.ticker) ?? 0) + (t.action === 'BUY' ? Number(t.qty) : -Number(t.qty)));
    posByUser.set(t.user_id, m);
  }

  return profiles.map((p) => {
    const cash = balByUser.get(p.id) ?? START_BALANCE;
    let positionsValue = 0;
    for (const [ticker, qty] of posByUser.get(p.id) ?? []) {
      if (qty > 0) positionsValue += qty * (quotes.get(ticker)?.price ?? 0);
    }
    return { userId: p.id, name: p.display_name || 'Anonymous', total: cash + positionsValue };
  });
}

// Current standings for every opted-in user. Shared by the leaderboard API and
// the daily snapshot cron.
export async function computeStandings(admin: ReturnType<typeof createSupabaseAdmin>): Promise<Standing[]> {
  const [{ data: profiles }, { data: balances }, { data: trades }, quotes] = await Promise.all([
    admin.from('profiles').select('id, display_name').eq('leaderboard_opt_in', true),
    admin.from('paper_balances').select('user_id, balance'),
    admin.from('paper_trades').select('user_id, ticker, action, qty, price'),
    fetchAllQuotes().catch(() => new Map()),
  ]);
  return aggregateStandings(
    (profiles ?? []) as LbProfile[],
    (balances ?? []) as LbBalance[],
    (trades ?? []) as LbTrade[],
    quotes as Map<string, { price: number }>
  );
}
