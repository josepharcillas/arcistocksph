import cron from 'node-cron';
import { runAutoTrade } from './autoTrade';

// In-process scheduler: while the server is running, fire the auto-trade bot on a
// daily cron with no external scheduler needed. Initialised once from middleware.
// PSE closes ~3:20pm PHT (07:20 UTC); default run is just after close, Mon–Fri.
// Override AUTOTRADE_CRON (UTC) or set DISABLE_BOT_SCHEDULER=1 to turn it off.

let started = false;

export function initScheduler(): void {
  if (started) return;
  if (process.env.DISABLE_BOT_SCHEDULER === '1' || import.meta.env?.DISABLE_BOT_SCHEDULER === '1') return;
  started = true;

  const expr = process.env.AUTOTRADE_CRON ?? import.meta.env?.AUTOTRADE_CRON ?? '20 7 * * 1-5';
  if (!cron.validate(expr)) {
    console.warn('[scheduler] invalid AUTOTRADE_CRON, bot scheduler disabled:', expr);
    return;
  }

  cron.schedule(expr, async () => {
    try {
      const r = await runAutoTrade();
      console.log(`[auto-trade] ${r.actions.length} action(s) · equity ₱${r.equity.toFixed(2)} (${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(2)}%)`);
    } catch (err) {
      console.warn('[auto-trade] run failed:', err instanceof Error ? err.message : err);
    }
  }, { timezone: 'Etc/UTC' });

  console.log(`[scheduler] auto-trade bot scheduled: "${expr}" (UTC)`);
}
