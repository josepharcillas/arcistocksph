import cron from 'node-cron';
import { runAutoTrade } from './autoTrade';
import { runDcaBot } from './dcaBot';
import { writeDailyReport } from './scoreboard';
import { refreshSignals } from './refreshSignals';
import { syncDividends } from './market/dividendDisclosures';
import { checkDividendEntryAlerts } from './dividendAlerts';

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

// The guard lives on globalThis, not in a module variable: Vite/Astro dev SSR
// re-evaluates this module on reload, which resets module state while the
// node-cron jobs registered by the previous evaluation keep running in the same
// process. That stacked one extra registration per reload — on 2026-07-06 the
// DCA bot had accumulated 23 of them and fired 23 concurrent runs at 02:15 UTC,
// racing each other's read-modify-write of portfolio_cash. A globalThis key
// survives re-evaluation, so the second and later inits become no-ops.
type ScheduledTask = ReturnType<typeof cron.schedule>;
const SCHED_KEY = Symbol.for('arcistocks.scheduler');
const g = globalThis as unknown as { [SCHED_KEY]?: { tasks: ScheduledTask[] } };

export function initScheduler(): void {
  if (process.env.DISABLE_BOT_SCHEDULER === '1' || import.meta.env?.DISABLE_BOT_SCHEDULER === '1') return;
  if (g[SCHED_KEY]) return;

  const registry: { tasks: ScheduledTask[] } = { tasks: [] };
  g[SCHED_KEY] = registry;
  const schedule = (expr: string, fn: () => void | Promise<void>, opts?: Parameters<typeof cron.schedule>[2]) => {
    registry.tasks.push(cron.schedule(expr, fn, opts));
  };

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
    schedule(expr, run('stock'), { timezone: 'Etc/UTC' });
    scheduled.push(expr);
  }

  // Crypto trades 24/7 but on a calm cadence — every 4h, matching the signal
  // cache, so it reacts to confirmed trends instead of every wobble.
  const cryptoExpr = process.env.AUTOTRADE_CRYPTO_CRON ?? import.meta.env?.AUTOTRADE_CRYPTO_CRON ?? '0 */4 * * *';
  let cryptoScheduled = false;
  if (process.env.DISABLE_CRYPTO_BOT !== '1' && cron.validate(cryptoExpr)) {
    schedule(cryptoExpr, run('crypto'), { timezone: 'Etc/UTC' });
    cryptoScheduled = true;
  }

  // DCA investor bot — weekly scheduled buys (Mon 10:15am PHT), never influenced
  // by signals or price levels. The evidence-backed slow strategy.
  const dcaExpr = process.env.DCA_CRON ?? import.meta.env?.DCA_CRON ?? '15 2 * * 1';
  let dcaScheduled = false;
  if (process.env.DISABLE_DCA_BOT !== '1' && cron.validate(dcaExpr)) {
    schedule(dcaExpr, async () => {
      try {
        const r = await runDcaBot();
        console.log(`[dca-bot] ${r.actions.length} action(s) · equity ₱${r.equity.toFixed(2)} (${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(2)}%)`);
      } catch (err) {
        console.warn('[dca-bot] run failed:', err instanceof Error ? err.message : err);
      }
    }, { timezone: 'Etc/UTC' });
    dcaScheduled = true;
  }

  // Signal refresh — five rings (holdings + watchlists + top-active + liquid-
  // stock rotation + crypto rotation), so the signals page, movers panel, and
  // advisor track the WHOLE liquid market (there is no external crontab; this
  // server IS the service). Weekday runs at 10:00am + 2:00pm PHT cover stocks +
  // crypto; a daily 8:30am/8:30pm PHT crypto-only run keeps coin coverage
  // building on weekends when the PSE runs are silent. Ring sizes are the
  // AI-budget knobs. Override SIGNAL_REFRESH_CRON / SIGNAL_REFRESH_CRYPTO_CRON
  // (';'-separated UTC exprs), SIGNAL_REFRESH_TOP_ACTIVE / _ROTATE / _CRYPTO;
  // DISABLE_SIGNAL_REFRESH=1 turns it all off.
  const refreshExprs = (process.env.SIGNAL_REFRESH_CRON ?? import.meta.env?.SIGNAL_REFRESH_CRON ?? '0 2 * * 1-5;0 6 * * 1-5')
    .split(';').map((s) => s.trim()).filter((e) => e && cron.validate(e));
  const cryptoRefreshExprs = (process.env.SIGNAL_REFRESH_CRYPTO_CRON ?? import.meta.env?.SIGNAL_REFRESH_CRYPTO_CRON ?? '30 0 * * *;30 12 * * *')
    .split(';').map((s) => s.trim()).filter((e) => e && cron.validate(e));
  let refreshScheduled = false;
  if (process.env.DISABLE_SIGNAL_REFRESH !== '1') {
    const sizes = {
      topActive: Number(process.env.SIGNAL_REFRESH_TOP_ACTIVE ?? 30),
      rotate: Number(process.env.SIGNAL_REFRESH_ROTATE ?? 30),
      cryptoTop: Number(process.env.SIGNAL_REFRESH_CRYPTO ?? 15),
    };
    const runRefresh = (opts: Parameters<typeof refreshSignals>[0], label: string) => async () => {
      try {
        const r = await refreshSignals(opts);
        console.log(`[refresh-signals:${label}] checked ${r.checked} (held ${r.held} · watch ${r.watch} · active ${r.active} · rotate ${r.rotate} · crypto ${r.crypto}) · recomputed ${r.recomputed} · errors ${r.errors}`);
      } catch (err) {
        console.warn(`[refresh-signals:${label}] run failed:`, err instanceof Error ? err.message : err);
      }
    };
    for (const expr of refreshExprs) {
      schedule(expr, runRefresh(sizes, 'market'), { timezone: 'Etc/UTC' });
      refreshScheduled = true;
    }
    for (const expr of cryptoRefreshExprs) {
      schedule(expr, runRefresh({ topActive: 0, rotate: 0, cryptoTop: sizes.cryptoTop }, 'crypto'), { timezone: 'Etc/UTC' });
      refreshScheduled = true;
    }
  }

  // Dividend tracker: pull the day's new cash-dividend disclosures from PSE
  // Edge after close (6:05pm PHT daily — incremental, a few requests), then
  // rate entries + push STRONG ENTRY alerts before the next open (8:20am PHT,
  // weekdays; reads only the DB, no AI calls). Overrides DIVIDEND_SYNC_CRON /
  // DIVIDEND_ALERT_CRON; disable with DISABLE_DIVIDEND_TRACKER=1.
  let dividendScheduled = false;
  if (process.env.DISABLE_DIVIDEND_TRACKER !== '1') {
    const syncExpr = process.env.DIVIDEND_SYNC_CRON ?? import.meta.env?.DIVIDEND_SYNC_CRON ?? '5 10 * * *';
    const alertExpr = process.env.DIVIDEND_ALERT_CRON ?? import.meta.env?.DIVIDEND_ALERT_CRON ?? '20 0 * * 1-5';
    if (cron.validate(syncExpr)) {
      schedule(syncExpr, async () => {
        try {
          const r = await syncDividends();
          console.log(`[dividend-sync] +${r.inserted} new (seen ${r.seen}, known ${r.skippedKnown}, errors ${r.errors})`);
        } catch (err) {
          console.warn('[dividend-sync] failed:', err instanceof Error ? err.message : err);
        }
      }, { timezone: 'Etc/UTC' });
      dividendScheduled = true;
    }
    if (cron.validate(alertExpr)) {
      schedule(alertExpr, async () => {
        try {
          const r = await checkDividendEntryAlerts();
          console.log(`[dividend-alerts] strong: ${r.strongEntries.join(', ') || 'none'} · pushes ${r.alertsSent}`);
        } catch (err) {
          console.warn('[dividend-alerts] failed:', err instanceof Error ? err.message : err);
        }
      }, { timezone: 'Etc/UTC' });
      dividendScheduled = true;
    }
  }

  // Daily report: log + save a both-bots scoreboard once a day after PSE close
  // (default 3:35pm PHT = 07:35 UTC). Override AUTOTRADE_REPORT_CRON; set
  // DISABLE_DAILY_REPORT=1 to turn off.
  const reportExpr = process.env.AUTOTRADE_REPORT_CRON ?? import.meta.env?.AUTOTRADE_REPORT_CRON ?? '35 7 * * *';
  let reportScheduled = false;
  if (process.env.DISABLE_DAILY_REPORT !== '1' && cron.validate(reportExpr)) {
    schedule(reportExpr, () => { writeDailyReport().catch((e) => console.warn('[daily-report] failed:', e)); }, { timezone: 'Etc/UTC' });
    reportScheduled = true;
  }

  if (scheduled.length === 0 && !cryptoScheduled) {
    console.warn('[scheduler] no valid cron expressions — bot scheduler disabled');
    // Tear down everything already registered above (DCA, signal refresh,
    // dividends, report) before releasing the guard. Simply clearing the guard
    // would let the next init register a second copy of each of them.
    for (const t of registry.tasks) t.stop();
    registry.tasks.length = 0;
    delete g[SCHED_KEY];
    return;
  }
  console.log(`[scheduler] STOCK AI bot (UTC): ${scheduled.map((e) => `"${e}"`).join(', ')} — 9:45am + 3:00pm PHT, Mon–Fri`);
  if (cryptoScheduled) console.log(`[scheduler] CRYPTO AI bot (UTC): "${cryptoExpr}" — every 4h, 24/7`);
  if (dcaScheduled) console.log(`[scheduler] DCA bot (UTC): "${dcaExpr}" — weekly, Mon 10:15am PHT`);
  if (refreshScheduled) console.log(`[scheduler] SIGNAL refresh (UTC): market ${refreshExprs.map((e) => `"${e}"`).join(', ')} · crypto ${cryptoRefreshExprs.map((e) => `"${e}"`).join(', ')} — all liquid stocks + all active coins`);
  if (reportScheduled) console.log(`[scheduler] DAILY report (UTC): "${reportExpr}" — logs + saves ./reports`);
  if (dividendScheduled) console.log('[scheduler] DIVIDEND tracker: sync 6:05pm PHT daily · entry alerts 8:20am PHT weekdays');
}
