import cron from 'node-cron';
import { runAutoTrade } from './autoTrade';

// In-process scheduler: while the server is running, fire the auto-trade bot on a
// cron with no external scheduler needed. Initialised once from middleware.
//
// Default cadence: EVERY 5 MINUTES across the whole PSE trading session,
// 9:30am–3:30pm PHT, Mon–Fri — so the bot behaves like a trader watching the
// monitor all day and acting on the app's live suggestions. PHT is UTC+8, so the
// session 9:30am–3:30pm PHT = 01:30–07:30 UTC. node-cron times are set in UTC.
// (Signals are still 4h-cached: the app's BUY/SELL "suggestions" refresh every 4h,
// while these 5-min runs continuously react to live prices and deploy/free cash.)
//
// Override with AUTOTRADE_CRON (one or more UTC cron exprs, ';'-separated), or set
// DISABLE_BOT_SCHEDULER=1 to turn it off.

// Every 5 min, 9:30am–3:30pm PHT (Mon–Fri), expressed in UTC (PHT−8):
const DEFAULT_CRONS = [
  '30-55/5 1 * * 1-5', // 9:30–9:55am PHT
  '*/5 2-6 * * 1-5',   // 10:00am–2:55pm PHT
  '0-30/5 7 * * 1-5',  // 3:00–3:30pm PHT
];

let started = false;

export function initScheduler(): void {
  if (started) return;
  if (process.env.DISABLE_BOT_SCHEDULER === '1' || import.meta.env?.DISABLE_BOT_SCHEDULER === '1') return;
  started = true;

  const override = process.env.AUTOTRADE_CRON ?? import.meta.env?.AUTOTRADE_CRON;
  const exprs = override ? override.split(';').map((s) => s.trim()).filter(Boolean) : DEFAULT_CRONS;

  const run = async () => {
    try {
      const r = await runAutoTrade();
      console.log(`[auto-trade] ${r.actions.length} action(s) · equity ₱${r.equity.toFixed(2)} (${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(2)}%)`);
    } catch (err) {
      console.warn('[auto-trade] run failed:', err instanceof Error ? err.message : err);
    }
  };

  const scheduled: string[] = [];
  for (const expr of exprs) {
    if (!cron.validate(expr)) {
      console.warn('[scheduler] skipping invalid cron expr:', expr);
      continue;
    }
    cron.schedule(expr, run, { timezone: 'Etc/UTC' });
    scheduled.push(expr);
  }

  if (scheduled.length === 0) {
    console.warn('[scheduler] no valid cron expressions — bot scheduler disabled');
    started = false;
    return;
  }
  console.log(`[scheduler] auto-trade bot scheduled (UTC): ${scheduled.map((e) => `"${e}"`).join(', ')} — every 5 min, 9:30am–3:30pm PHT, Mon–Fri`);
}
