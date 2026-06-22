import type { Fundamentals } from '../ai/types';

// Fundamentals (P/E, EPS, dividend yield) from a configured external API.
// PSE Edge doesn't expose these, so this fills the gap. KEY-GATED: with no
// FUNDAMENTALS_API_KEY set it returns {} and makes no network call — so the app
// behaves exactly as before until a key is provided.
//
// Provider via FUNDAMENTALS_PROVIDER (default 'eodhd'). PSE symbol mapping:
//   eodhd      -> `${TICKER}.PSE`        GET /api/fundamentals/SM.PSE
//   twelvedata -> symbol=TICKER&exchange=PSE
// Free tiers of these providers often DON'T include PSE fundamentals (paid
// add-on) — in that case fields come back null, which is handled gracefully.

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return typeof n === 'number' && isFinite(n) ? n : null;
};

export async function fetchFundamentalsApi(ticker: string): Promise<Partial<Fundamentals>> {
  const key = env('FUNDAMENTALS_API_KEY');
  if (!key) return {};
  const provider = (env('FUNDAMENTALS_PROVIDER') ?? 'eodhd').toLowerCase();
  const sym = ticker.toUpperCase().replace(/\.PS$/, '').trim();

  try {
    if (provider === 'twelvedata') return await fromTwelveData(sym, key);
    return await fromEodhd(sym, key);
  } catch {
    return {}; // never let a fundamentals miss break the analysis
  }
}

async function fromEodhd(sym: string, key: string): Promise<Partial<Fundamentals>> {
  const res = await fetch(`https://eodhd.com/api/fundamentals/${sym}.PSE?api_token=${encodeURIComponent(key)}&fmt=json`);
  if (!res.ok) return {};
  const j: any = await res.json();
  const h = j?.Highlights ?? {};
  const dy = num(h.DividendYield); // EODHD returns a decimal (0.03 = 3%)
  return {
    pe: num(h.PERatio),
    eps: num(h.EarningsShare),
    dividendYield: dy != null ? dy * 100 : null,
    bookValue: num(h.BookValue),
    marketCap: num(h.MarketCapitalization),
  };
}

async function fromTwelveData(sym: string, key: string): Promise<Partial<Fundamentals>> {
  const res = await fetch(`https://api.twelvedata.com/statistics?symbol=${sym}&exchange=PSE&apikey=${encodeURIComponent(key)}`);
  if (!res.ok) return {};
  const j: any = await res.json();
  const v = j?.statistics?.valuations_metrics ?? {};
  const d = j?.statistics?.dividends_and_splits ?? {};
  const dy = num(d.trailing_annual_dividend_yield ?? d.forward_annual_dividend_yield);
  return {
    pe: num(v.trailing_pe ?? v.forward_pe),
    eps: num(v.eps), // present on some plans; null otherwise
    dividendYield: dy != null ? dy * 100 : null,
  };
}
