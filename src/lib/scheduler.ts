import cron from 'node-cron';
import { runAutoTrade } from './autoTrade';
import { writeDailyReport } from './scoreboard';

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

  // Crypto trades 24/7 — run it round the clock (default every 15 min). Lighter
  // cadence than stocks to stay friendly to CoinGecko's free rate limits.
  const cryptoExpr = process.env.AUTOTRADE_CRYPTO_CRON ?? import.meta.env?.AUTOTRADE_CRYPTO_CRON ?? '*/15 * * * *';
  let cryptoScheduled = false;
  if (process.env.DISABLE_CRYPTO_BOT !== '1' && cron.validate(cryptoExpr)) {
    cron.schedule(cryptoExpr, run('crypto'), { timezone: 'Etc/UTC' });
    cryptoScheduled = true;
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
  console.log(`[scheduler] STOCK bot (UTC): ${scheduled.map((e) => `"${e}"`).join(', ')} — every 5 min, 9:30am–3:30pm PHT, Mon–Fri`);
  if (cryptoScheduled) console.log(`[scheduler] CRYPTO bot (UTC): "${cryptoExpr}" — 24/7`);
  if (reportScheduled) console.log(`[scheduler] DAILY report (UTC): "${reportExpr}" — logs + saves ./reports`);
}
