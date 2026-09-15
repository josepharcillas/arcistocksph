// Daily "best time to go in" push: when a high-yield dividend stock reaches a
// STRONG ENTRY rating, notify every push-subscribed user — once per state, not
// every morning (dedup via dividend_alert_state signatures).
import { query } from './db';
import { getDividendBoard } from './dividends';
import { isPushConfigured, sendPushToUser } from './push/send';

export interface DividendAlertResult {
  ok: true;
  strongEntries: string[];
  alertsSent: number;
  recipients: number;
}

export async function checkDividendEntryAlerts(): Promise<DividendAlertResult> {
  const board = await getDividendBoard(60);
  const strong = board.rows.filter((r) => r.entry.rating === 'STRONG ENTRY');
  const strongTickers = strong.map((r) => r.ticker);

  const stateRows = await query<{ ticker: string; signature: string }>(`select ticker, signature from dividend_alert_state`);
  const state = new Map(stateRows.map((s) => [s.ticker, s.signature]));

  // A ticker that dropped out of STRONG resets, so a later re-entry re-alerts.
  const dropped = [...state.keys()].filter((t) => !strongTickers.includes(t));
  if (dropped.length) await query(`delete from dividend_alert_state where ticker = any($1::text[])`, [dropped]);

  const fresh = strong.filter((r) => {
    const sig = `${r.entry.rating}|${r.nextRecordDate ?? ''}`;
    return state.get(r.ticker) !== sig;
  });
  if (fresh.length === 0 || !isPushConfigured()) {
    return { ok: true, strongEntries: strongTickers, alertsSent: 0, recipients: 0 };
  }

  const subs = await query<{ user_id: string }>(`select distinct user_id from push_subscriptions`);
  const userIds = subs.map((s) => s.user_id);

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
    await query(
      `insert into dividend_alert_state (ticker, signature, sent_at) values ($1, $2, now())
         on conflict (ticker) do update set signature = excluded.signature, sent_at = excluded.sent_at`,
      [r.ticker, `${r.entry.rating}|${r.nextRecordDate ?? ''}`]
    );
  }

  return { ok: true, strongEntries: strongTickers, alertsSent: sent, recipients: userIds.length };
}
