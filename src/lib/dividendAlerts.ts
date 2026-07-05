// Daily "best time to go in" push: when a high-yield dividend stock reaches a
// STRONG ENTRY rating, notify every push-subscribed user — once per state, not
// every morning (dedup via dividend_alert_state signatures).
import { createSupabaseAdmin } from './supabase-admin';
import { getDividendBoard } from './dividends';
import { isPushConfigured, sendPushToUser } from './push/send';

export interface DividendAlertResult {
  ok: true;
  strongEntries: string[];
  alertsSent: number;
  recipients: number;
}

export async function checkDividendEntryAlerts(): Promise<DividendAlertResult> {
  const admin = createSupabaseAdmin();
  const board = await getDividendBoard(60);
  const strong = board.rows.filter((r) => r.entry.rating === 'STRONG ENTRY');
  const strongTickers = strong.map((r) => r.ticker);

  const { data: stateRows } = await admin.from('dividend_alert_state').select('ticker, signature');
  const state = new Map((stateRows ?? []).map((s: any) => [s.ticker as string, s.signature as string]));

  // A ticker that dropped out of STRONG resets, so a later re-entry re-alerts.
  const dropped = [...state.keys()].filter((t) => !strongTickers.includes(t));
  if (dropped.length) await admin.from('dividend_alert_state').delete().in('ticker', dropped);

  const fresh = strong.filter((r) => {
    const sig = `${r.entry.rating}|${r.nextRecordDate ?? ''}`;
    return state.get(r.ticker) !== sig;
  });
  if (fresh.length === 0 || !isPushConfigured()) {
    return { ok: true, strongEntries: strongTickers, alertsSent: 0, recipients: 0 };
  }

  const { data: subs } = await admin.from('push_subscriptions').select('user_id');
  const userIds = [...new Set((subs ?? []).map((s: any) => s.user_id as string))];

  let sent = 0;
  for (const r of fresh) {
    const payload = {
      title: `💰 Dividend entry: ${r.ticker} yields ${r.yieldPct.toFixed(1)}%`,
      body: r.entry.reasons.slice(0, 3).join(' · ').slice(0, 180),
      url: '/dividends',
      ticker: r.ticker,
    };
    for (const uid of userIds) {
      try { sent += await sendPushToUser(uid, payload); }
      catch (err) { console.warn('[dividend-alerts] push failed', err instanceof Error ? err.message : err); }
    }
    await admin.from('dividend_alert_state').upsert({
      ticker: r.ticker,
      signature: `${r.entry.rating}|${r.nextRecordDate ?? ''}`,
      sent_at: new Date().toISOString(),
    });
  }

  return { ok: true, strongEntries: strongTickers, alertsSent: sent, recipients: userIds.length };
}
