import cron from 'node-cron';
import { runAutoTrade } from './autoTrade';
import { runDcaBot } from './dcaBot';
import { writeDailyReport } from './scoreboard';
import { refreshSignals } from './refreshSignals';

// In-process scheduler: while the server is running, fire the bots on cron with
// no external scheduler needed. Initialised once from middleware.
//
// Cadence follows the 2026-07-02 research (overtrading is the documented #1 bot
// killer; trend systems checked less often beat daily-checked ones):
//   STOCK AI bot  — twice per session: 9:45am + 3:00pm PHT, Mon–Fri
//   CRYPTO AI bot — every 4 hours, 24/7 (matches the 4h signal cache)
//   DCA bot       — weekly: Monday 10:15am PHT (fixed-schedule investing)
// PHT = UTC+8; node-cron times below are UTC.
//
// Override with AUTOTRADE_CRON (';'-separated UTC exprs), AUTOTRADE_CRYPTO_CRON,
// DCA_CRON; or set DISABLE_BOT_SCHEDULER=1 to turn everything off.

const DEFAULT_CRONS = [
  '45 1 * * 1-5', // 9:45am PHT — after the open settles
  '0 7 * * 1-5',  // 3:00pm PHT — before the close
];

let started = false;

export function initScheduler(): void {
  if (started) return;
  if (process.env.DISABLE_BOT_SCHEDULER === '1' || import.meta.env?.DISABLE_BOT_SCHEDULER === '1') return;
  started = true;

  const override = process.env.AUTOTRADE_CRON ?? import.meta.env?.AUTOTRADE_CRON;
  const exprs = override ? override.split(';').map((s) => s.trim()).filter(Boolean) : DEFAULT_CRONS;

  const run = (assetClass: 'stock' | 'crypto') => async () => {
    try {
      const r = await runAutoTrade({ assetClass });
      console.log(`[auto-trade:${assetClass}] ${r.actions.length} action(s) · equity ₱${r.equity.toFixed(2)} (${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(2)}%)`);
    } catch (err) {
      console.warn(`[auto-trade:${assetClass}] run failed:`, err instanceof Error ? err.message : err);
    }
  };

  const scheduled: string[] = [];
  for (const expr of exprs) {
    if (!cron.validate(expr)) {
      console.warn('[scheduler] skipping invalid stock cron expr:', expr);
      continue;
    }
    cron.schedule(expr, run('stock'), { timezone: 'Etc/UTC' });
    scheduled.push(expr);
  }

  // Crypto trades 24/7 but on a calm cadence — every 4h, matching the signal
  // cache, so it reacts to confirmed trends instead of every wobble.
  const cryptoExpr = process.env.AUTOTRADE_CRYPTO_CRON ?? import.meta.env?.AUTOTRADE_CRYPTO_CRON ?? '0 */4 * * *';
  let cryptoScheduled = false;
  if (process.env.DISABLE_CRYPTO_BOT !== '1' && cron.validate(cryptoExpr)) {
    cron.schedule(cryptoExpr, run('crypto'), { timezone: 'Etc/UTC' });
    cryptoScheduled = true;
  }

  // DCA investor bot — weekly scheduled buys (Mon 10:15am PHT), never influenced
  // by signals or price levels. The evidence-backed slow strategy.
  const dcaExpr = process.env.DCA_CRON ?? import.meta.env?.DCA_CRON ?? '15 2 * * 1';
  let dcaScheduled = false;
  if (process.env.DISABLE_DCA_BOT !== '1' && cron.validate(dcaExpr)) {
    cron.schedule(dcaExpr, async () => {
      try {
        const r = await runDcaBot();
        console.log(`[dca-bot] ${r.actions.length} action(s) · equity ₱${r.equity.toFixed(2)} (${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(2)}%)`);
      } catch (err) {
        console.warn('[dca-bot] run failed:', err instanceof Error ? err.message : err);
      }
    }, { timezone: 'Etc/UTC' });
    dcaScheduled = true;
  }

  // Signal refresh — holdings + watchlists + top-30 most-active, so the signals
  // page, movers panel, and advisor track the live market (there is no external
  // crontab; this server IS the service). 10:00am + 2:00pm PHT Mon–Fri, offset
  // from the bot runs (9:45am/3:00pm) to spread AI-provider load; the 4h signal
  // cache keeps the second run cheap. Override SIGNAL_REFRESH_CRON (';'-separated
  // UTC exprs) / SIGNAL_REFRESH_TOP_ACTIVE; DISABLE_SIGNAL_REFRESH=1 turns it off.
  const refreshExprs = (process.env.SIGNAL_REFRESH_CRON ?? import.meta.env?.SIGNAL_REFRESH_CRON ?? '0 2 * * 1-5;0 6 * * 1-5')
    .split(';').map((s) => s.trim()).filter((e) => e && cron.validate(e));
  let refreshScheduled = false;
  if (process.env.DISABLE_SIGNAL_REFRESH !== '1') {
    const topActive = Number(process.env.SIGNAL_REFRESH_TOP_ACTIVE ?? 30);
    for (const expr of refreshExprs) {
      cron.schedule(expr, async () => {
        try {
          const r = await refreshSignals(topActive);
          console.log(`[refresh-signals] checked ${r.checked} (held ${r.held} · watch ${r.watch} · active ${r.active}) · recomputed ${r.recomputed} · errors ${r.errors}`);
        } catch (err) {
          console.warn('[refresh-signals] run failed:', err instanceof Error ? err.message : err);
        }
      }, { timezone: 'Etc/UTC' });
      refreshScheduled = true;
    }
  }

  // Daily report: log + save a both-bots scoreboard once a day after PSE close
  // (default 3:35pm PHT = 07:35 UTC). Override AUTOTRADE_REPORT_CRON; set
  // DISABLE_DAILY_REPORT=1 to turn off.
  const reportExpr = process.env.AUTOTRADE_REPORT_CRON ?? import.meta.env?.AUTOTRADE_REPORT_CRON ?? '35 7 * * *';
  let reportScheduled = false;
  if (process.env.DISABLE_DAILY_REPORT !== '1' && cron.validate(reportExpr)) {
    cron.schedule(reportExpr, () => { writeDailyReport().catch((e) => console.warn('[daily-report] failed:', e)); }, { timezone: 'Etc/UTC' });
    reportScheduled = true;
  }

  if (scheduled.length === 0 && !cryptoScheduled) {
    console.warn('[scheduler] no valid cron expressions — bot scheduler disabled');
    started = false;
    return;
  }
  console.log(`[scheduler] STOCK AI bot (UTC): ${scheduled.map((e) => `"${e}"`).join(', ')} — 9:45am + 3:00pm PHT, Mon–Fri`);
  if (cryptoScheduled) console.log(`[scheduler] CRYPTO AI bot (UTC): "${cryptoExpr}" — every 4h, 24/7`);
  if (dcaScheduled) console.log(`[scheduler] DCA bot (UTC): "${dcaExpr}" — weekly, Mon 10:15am PHT`);
  if (refreshScheduled) console.log(`[scheduler] SIGNAL refresh (UTC): ${refreshExprs.map((e) => `"${e}"`).join(', ')} — holdings + watchlists + top-active`);
  if (reportScheduled) console.log(`[scheduler] DAILY report (UTC): "${reportExpr}" — logs + saves ./reports`);
}
