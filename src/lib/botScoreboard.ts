// Server-side assembler for the owner-only /dashboard/bots page: gathers all
// three paper-trading bots' stats, benchmarks, equity curves, and transaction
// timelines in one call. Read-only. Uses the admin client (bots run under
// service accounts, so RLS is bypassed) and the SAME win-rate/benchmark math as
// scripts/scoreboard.mjs (via botStats.mjs) so the page and the terminal agree.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createSupabaseAdmin } from './supabase-admin';
import { fetchAllQuotes } from './market';
import { fetchTopCryptoQuotes } from './market/crypto';
import { STARTING_CASH } from './autoTrade';
import { winRateReplay, alpha, basketReturn } from '../../scripts/lib/botStats.mjs';

const display = (t: string) => t.replace(/^X:/, '');

const BOTS = [
  { key: 'stock', label: 'AI STOCKS', icon: '📈', email: process.env.BOT_EMAIL ?? 'bot@arcistocks.local', benchmark: 'PSEi-30' as const },
  { key: 'crypto', label: 'AI CRYPTO', icon: '🪙', email: process.env.CRYPTO_BOT_EMAIL ?? 'crypto-bot@arcistocks.local', benchmark: 'BTC' as const },
  { key: 'dca', label: 'DCA 🐢', icon: '🐢', email: process.env.DCA_BOT_EMAIL ?? 'dca-bot@arcistocks.local', benchmark: null },
] as const;

export type TxAction = 'BUY' | 'SELL' | 'DIVIDEND';

export interface BotTransaction {
  date: string;
  action: TxAction;
  ticker: string;
  qty: number | null;
  price: number | null;   // per-unit price; for DIVIDEND this is amount/share
  value: number;          // peso value of the transaction
  reason: string | null;
}

interface RawTrade {
  ticker: string; action: string; qty: number | string; price: number | string;
  reason?: string | null; traded_at?: string | null;
}
interface RawDividend {
  ticker: string; pesos: number | string; amount?: number | string | null;
  payment_date?: string | null; credited_at?: string | null;
}

/** Merge a bot's trades and (DCA) dividend credits into one newest-first
 *  timeline. Pure — unit-tested in botScoreboard.test.ts. */
export function mergeTransactions(trades: RawTrade[] = [], dividends: RawDividend[] = []): BotTransaction[] {
  const fromTrade = (t: RawTrade): BotTransaction => {
    const qty = Number(t.qty);
    const price = Number(t.price);
    return {
      date: t.traded_at ?? '',
      action: t.action === 'SELL' ? 'SELL' : 'BUY',
      ticker: display(t.ticker),
      qty, price, value: qty * price,
      reason: t.reason ?? null,
    };
  };
  const fromDividend = (d: RawDividend): BotTransaction => {
    const amount = d.amount != null ? Number(d.amount) : null;
    const pesos = Number(d.pesos);
    const qty = amount && amount > 0 ? pesos / amount : null;
    return {
      date: d.payment_date ?? d.credited_at ?? '',
      action: 'DIVIDEND',
      ticker: display(d.ticker),
      qty, price: amount, value: pesos,
      reason: amount != null ? `Cash dividend ₱${amount.toFixed(4)}/sh received.` : 'Cash dividend received.',
    };
  };
  const all = [...trades.map(fromTrade), ...dividends.map(fromDividend)];
  return all.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

export interface BotView {
  key: string;
  label: string;
  icon: string;
  equity: number;
  pnlPct: number;
  cash: number;
  positions: number;
  tradeCount: number;
  winRate: number | null;
  realized: number;
  benchmarkLabel: string | null;
  benchmarkPct: number | null;
  alphaPct: number | null;
  equityCurve: { date: string; value: number }[];
  transactions: BotTransaction[];
  startDate: string | null;
}

export interface BotScoreboard {
  asOf: string;
  bots: BotView[];
}

// BTC buy-and-hold % return since `sinceDate` (CoinGecko history, PHP) — mirrors
// scripts/scoreboard.mjs so the crypto benchmark matches.
async function btcReturnSince(sinceDate: string | null): Promise<number | null> {
  if (!sinceDate) return null;
  const days = Math.min(365, Math.max(2, Math.ceil((Date.now() - new Date(sinceDate).getTime()) / 86400000) + 1));
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=php&days=${days}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const prices: [number, number][] = (await r.json())?.prices ?? [];
    if (prices.length < 2) return null;
    const ts = new Date(sinceDate).getTime();
    const base = (prices.find((p) => p[0] >= ts) ?? prices[0])[1];
    const cur = prices[prices.length - 1][1];
    return base > 0 ? (cur / base - 1) * 100 : null;
  } catch { return null; }
}

// Equal-weight PSEi-30 basket return vs the forward-tracked baseline written by
// the scoreboard script (data/benchmark-baseline.json). Read-only here.
async function stockBasketReturn(prices: Map<string, number>): Promise<number | null> {
  try {
    const file = path.resolve(process.cwd(), 'data', 'benchmark-baseline.json');
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!data?.stock?.prices) return null;
    return basketReturn(data.stock.prices, prices);
  } catch { return null; }
}

async function summarizeBot(
  admin: ReturnType<typeof createSupabaseAdmin>,
  botId: string, withDividends: boolean, priceOf: (t: string) => number,
): Promise<Omit<BotView, 'key' | 'label' | 'icon' | 'benchmarkLabel' | 'benchmarkPct' | 'alphaPct'>> {
  const [{ data: holdings }, { data: cashRow }, { data: snaps }, { data: trades }, dividends] = await Promise.all([
    admin.from('holdings').select('ticker, qty, buy_price').eq('user_id', botId),
    admin.from('portfolio_cash').select('cash').eq('user_id', botId).maybeSingle(),
    admin.from('balance_snapshots').select('snapshot_date, total_value').eq('user_id', botId).order('snapshot_date'),
    admin.from('paper_trades').select('ticker, action, qty, price, reason, traded_at').eq('user_id', botId).order('traded_at', { ascending: true }),
    withDividends
      ? admin.from('dca_dividend_credits').select('pesos, credited_at, dividends(ticker, amount, payment_date)').eq('user_id', botId)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const cash = cashRow ? Number(cashRow.cash) : STARTING_CASH;
  const holdingsValue = (holdings ?? []).reduce((s: number, h: any) => s + Number(h.qty) * (priceOf(h.ticker) || Number(h.buy_price)), 0);
  const equity = cash + holdingsValue;

  const { closed: _c, realized, winRate } = winRateReplay((trades ?? []) as any[]);

  const divRows: RawDividend[] = ((dividends?.data ?? []) as any[]).map((r) => ({
    ticker: r.dividends?.ticker ?? '', pesos: r.pesos, amount: r.dividends?.amount,
    payment_date: r.dividends?.payment_date, credited_at: r.credited_at,
  })).filter((d) => d.ticker);

  return {
    equity, cash,
    pnlPct: ((equity - STARTING_CASH) / STARTING_CASH) * 100,
    positions: (holdings ?? []).length,
    tradeCount: (trades ?? []).length,
    winRate, realized,
    equityCurve: (snaps ?? []).map((s: any) => ({ date: s.snapshot_date, value: Number(s.total_value) })),
    transactions: mergeTransactions((trades ?? []) as RawTrade[], divRows),
    startDate: (snaps ?? [])[0]?.snapshot_date ?? null,
  };
}

/** Assemble the full three-bot scoreboard for the admin page. */
export async function getBotScoreboard(): Promise<BotScoreboard> {
  const admin = createSupabaseAdmin();
  const [stockQuotes, cryptoQuotes] = await Promise.all([
    fetchAllQuotes().catch(() => new Map()),
    fetchTopCryptoQuotes(Number(process.env.CRYPTO_UNIVERSE ?? 250)).catch(() => new Map()),
  ]);
  const priceOf = (t: string): number =>
    t.startsWith('X:') ? ((cryptoQuotes as Map<string, any>).get(t)?.price ?? 0) : ((stockQuotes as Map<string, any>).get(t)?.price ?? 0);
  const stockPriceMap = new Map<string, number>([...(stockQuotes as Map<string, any>).values()].map((q: any) => [q.symbol as string, q.price as number]));

  const bots: BotView[] = [];
  for (const cfg of BOTS) {
    let botId: string;
    try {
      botId = await resolveBotId(admin, cfg.email);
    } catch {
      continue; // bot not seeded — skip rather than fail the whole page
    }
    const base = await summarizeBot(admin, botId, cfg.key === 'dca', priceOf);

    let benchmarkPct: number | null = null;
    if (cfg.benchmark === 'BTC') benchmarkPct = await btcReturnSince(base.startDate);
    else if (cfg.benchmark === 'PSEi-30') benchmarkPct = await stockBasketReturn(stockPriceMap);

    bots.push({
      key: cfg.key, label: cfg.label, icon: cfg.icon,
      ...base,
      benchmarkLabel: cfg.benchmark,
      benchmarkPct,
      alphaPct: alpha(base.pnlPct, benchmarkPct),
    });
  }

  return { asOf: new Date().toISOString(), bots };
}

// Resolve a bot's auth user id by email (paginated listUsers) — same approach as
// autoTrade/dcaBot, duplicated here to keep those internal helpers unexported.
async function resolveBotId(admin: ReturnType<typeof createSupabaseAdmin>, email: string): Promise<string> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const u = data?.users?.find((x) => x.email === email);
    if (u) return u.id;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  throw new Error(`Bot user ${email} not found`);
}
