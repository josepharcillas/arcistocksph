import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getBotState, type AssetClass } from './autoTrade';

// Shared scoreboard text + daily delivery for the auto-trade bots. The scheduler
// calls writeDailyReport() once a day (after PSE close) to log a summary and drop
// a dated file in ./reports, so there's a durable record of how the bots are doing.

const peso = (n: number) => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

function winRate(trades: { ticker: string; action: string; qty: number; price: number }[]) {
  const book: Record<string, { qty: number; cost: number }> = {};
  let wins = 0, closed = 0, realized = 0;
  // recentTrades come newest-first; replay oldest-first.
  for (const t of [...trades].reverse()) {
    const b = (book[t.ticker] ??= { qty: 0, cost: 0 });
    const q = Number(t.qty), pr = Number(t.price);
    if (t.action === 'BUY') { b.cost += q * pr; b.qty += q; }
    else { const avg = b.qty > 0 ? b.cost / b.qty : pr; const pl = (pr - avg) * q; realized += pl; closed++; if (pl >= 0) wins++; b.qty -= q; b.cost -= avg * q; }
  }
  return { closed, realized, rate: closed ? (wins / closed) * 100 : null };
}

export async function buildScoreboardText(): Promise<string> {
  const [stock, crypto] = await Promise.all([
    getBotState('stock').catch(() => null),
    getBotState('crypto').catch(() => null),
  ]);

  const line = '─'.repeat(56);
  const out: string[] = [];
  out.push(line);
  out.push(`  ARCISTOCKS BOT SCOREBOARD   ${new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}`);
  out.push(line);
  out.push('  ' + ''.padEnd(20) + 'STOCKS'.padStart(16) + 'CRYPTO'.padStart(16));
  out.push(line);

  const row = (label: string, fn: (s: any) => string) =>
    '  ' + label.padEnd(20) + (stock ? fn(stock) : '—').padStart(16) + (crypto ? fn(crypto) : '—').padStart(16);

  const wrS = stock ? winRate(stock.recentTrades) : null;
  const wrC = crypto ? winRate(crypto.recentTrades) : null;
  const wr = (a: AssetClass) => (a === 'stock' ? wrS : wrC);

  out.push(row('Equity', (s) => peso(s.equity)));
  out.push(row('Total P/L', (s) => pct(s.pnlPct)));
  out.push(row('Cash', (s) => peso(s.cash)));
  out.push(row('Open positions', (s) => String(s.holdings.length)));
  out.push(row('Win rate', (s) => { const w = wr(s.assetClass); return w?.rate == null ? '—' : w.rate.toFixed(0) + '%'; }));
  out.push(row('Realized P/L', (s) => { const w = wr(s.assetClass); return w ? peso(w.realized) : '—'; }));
  out.push(line);
  if (stock && crypto) {
    const lead = stock.pnlPct === crypto.pnlPct ? 'tied' : stock.pnlPct > crypto.pnlPct ? 'STOCKS lead' : 'CRYPTO leads';
    out.push(`  Leader so far: ${lead}`);
  }
  out.push('  Not financial advice — paper-trading simulation only.');
  return out.join('\n');
}

export async function writeDailyReport(): Promise<string> {
  const text = await buildScoreboardText();
  console.log('\n[daily-report]\n' + text + '\n');
  try {
    const dir = path.resolve(process.cwd(), 'reports');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `scoreboard-${new Date().toISOString().slice(0, 10)}.txt`);
    await fs.writeFile(file, text + '\n', 'utf8');
    console.log('[daily-report] saved', file);
  } catch (err) {
    console.warn('[daily-report] file write failed:', err instanceof Error ? err.message : err);
  }
  return text;
}
