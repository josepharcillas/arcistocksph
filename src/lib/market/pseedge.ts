import type { Fundamentals } from '../ai/types';

export async function fetchFundamentals(ticker: string): Promise<Fundamentals> {
  const empty: Fundamentals = { pe: null, eps: null, revenue: null, bookValue: null, dividendYield: null };

  try {
    // PSE Edge company page scrape
    const url = `https://edge.pse.com.ph/companyPage/stockData.do?cmpy_id=${encodeURIComponent(ticker)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return empty;

    const html = await res.text();

    const extract = (label: string): number | null => {
      const regex = new RegExp(`${label}[^\\d-]*([-\\d,.]+)`, 'i');
      const match = html.match(regex);
      if (!match) return null;
      const n = parseFloat(match[1].replace(/,/g, ''));
      return isNaN(n) ? null : n;
    };

    return {
      pe: extract('P\\/E'),
      eps: extract('EPS'),
      revenue: extract('Revenue'),
      bookValue: extract('Book Value'),
      dividendYield: extract('Dividend Yield'),
    };
  } catch {
    return empty;
  }
}
