import type { OHLCV, Fundamentals } from '../ai/types';

// PSE Edge (edge.pse.com.ph) — the official, free source for PSE historical
// prices and fundamentals. Flow: resolve ticker -> cmpyId -> securityId, then
// POST the chart endpoint for daily OHLCV.
const BASE = 'https://edge.pse.com.ph';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

interface Company {
  cmpyId: string;
  securityId: string;
  cookie: string;
}

// Resolving cmpyId/securityId costs two requests, so cache per ticker.
const companyCache = new Map<string, Company>();

function mmddyyyy(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}-${d.getFullYear()}`;
}

async function resolveCompany(ticker: string): Promise<Company> {
  const sym = ticker.toUpperCase().replace(/\.PS$/, '').trim();
  const cached = companyCache.get(sym);
  if (cached) return cached;

  // 1. ticker -> cmpyId
  const searchRes = await fetch(`${BASE}/autoComplete/searchCompanyNameSymbol.ax?term=${encodeURIComponent(sym)}`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!searchRes.ok) throw new Error(`PSE Edge search failed: ${searchRes.status}`);
  const matches: Array<{ cmpyId: string; symbol: string }> = await searchRes.json();
  const match = matches.find((m) => m.symbol?.toUpperCase() === sym) ?? matches[0];
  if (!match) throw new Error(`PSE Edge: no company for ${sym}`);

  // 2. cmpyId -> securityId (scraped from the company page; also yields a session cookie)
  const pageRes = await fetch(`${BASE}/companyPage/stockData.do?cmpy_id=${match.cmpyId}`, {
    headers: { 'User-Agent': UA },
  });
  if (!pageRes.ok) throw new Error(`PSE Edge stockData failed: ${pageRes.status}`);
  const html = await pageRes.text();
  const securityId = html.match(/security_id\s*=\s*["']?(\d+)/i)?.[1];
  if (!securityId) throw new Error(`PSE Edge: no security_id for ${sym}`);

  const setCookies = (pageRes.headers as any).getSetCookie?.() ?? [];
  const cookie = setCookies.map((c: string) => c.split(';')[0]).join('; ');

  const company: Company = { cmpyId: match.cmpyId, securityId, cookie };
  companyCache.set(sym, company);
  return company;
}

export async function fetchPriceHistory(ticker: string, days = 300): Promise<OHLCV[]> {
  const { cmpyId, securityId, cookie } = await resolveCompany(ticker);

  const end = new Date();
  const start = new Date(end.getTime() - days * 86400 * 1000);

  const res = await fetch(`${BASE}/common/DisclosureCht.ax`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${BASE}/companyPage/stockData.do?cmpy_id=${cmpyId}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({
      cmpy_id: cmpyId,
      security_id: securityId,
      startDate: mmddyyyy(start),
      endDate: mmddyyyy(end),
    }),
  });
  if (!res.ok) throw new Error(`PSE Edge chart failed: ${res.status}`);

  const json = await res.json();
  const rows: Array<Record<string, number | string>> = json?.chartData ?? [];

  return rows
    .map((r) => ({
      date: new Date(r.CHART_DATE as string).toISOString().split('T')[0],
      open: Number(r.OPEN) || 0,
      high: Number(r.HIGH) || 0,
      low: Number(r.LOW) || 0,
      close: Number(r.CLOSE) || 0,
      volume: Number(r.VALUE) || 0, // PSE Edge gives peso value traded, not share count
    }))
    .filter((d) => d.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

const EMPTY_FUNDAMENTALS: Fundamentals = {
  pe: null, eps: null, revenue: null, bookValue: null, dividendYield: null, marketCap: null, outstandingShares: null,
};

export async function fetchFundamentals(ticker: string): Promise<Fundamentals> {
  try {
    const { cmpyId } = await resolveCompany(ticker);
    const res = await fetch(`${BASE}/companyPage/stockData.do?cmpy_id=${cmpyId}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) return EMPTY_FUNDAMENTALS;
    const html = await res.text();

    // Values sit in the <td> immediately after each <th>Label</th>. Market Cap,
    // Outstanding Shares and Par Value are reliably populated; P/E and Book Value
    // are only filled during live trading sessions (often blank → null).
    const field = (label: string): number | null => {
      const re = new RegExp(`<th>\\s*${label}\\s*</th>\\s*<td[^>]*>\\s*([\\d.,]+)`, 'i');
      const m = html.match(re);
      if (!m) return null;
      const n = parseFloat(m[1].replace(/,/g, ''));
      return isNaN(n) ? null : n;
    };

    return {
      pe: field('P\\/E Ratio'),
      eps: null, // not exposed on PSE Edge stock page
      revenue: null,
      bookValue: field('Book Value'),
      dividendYield: null,
      marketCap: field('Market Capitalization'),
      outstandingShares: field('Outstanding Shares'),
    };
  } catch {
    return EMPTY_FUNDAMENTALS;
  }
}
