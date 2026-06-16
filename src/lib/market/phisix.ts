// Live PSE quotes via the free phisix API (no key). api3 is primary; api4 is a
// fallback (it intermittently 503s). One bulk call returns the whole market.
const HOSTS = ['https://phisix-api3.appspot.com', 'https://phisix-api4.appspot.com'];
const UA = { 'User-Agent': 'Mozilla/5.0' };

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  change1d: number; // percent
  volume: number;
}

function normalize(ticker: string): string {
  return ticker.toUpperCase().replace(/\.PS$/, '').trim();
}

export async function fetchQuote(ticker: string): Promise<{ price: number; change1d: number; volume: number }> {
  const sym = normalize(ticker);
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/stocks/${sym}.json`, { headers: UA });
      if (!res.ok) continue;
      const json = await res.json();
      const s = json?.stocks?.[0];
      if (!s) continue;
      return { price: s.price?.amount ?? 0, change1d: s.percentChange ?? 0, volume: s.volume ?? 0 };
    } catch {
      // try next host
    }
  }
  throw new Error(`phisix: no quote for ${sym}`);
}

/** All ~385 PSE stocks in a single call, keyed by ticker. Used by screener/watchlist. */
export async function fetchAllQuotes(): Promise<Map<string, Quote>> {
  for (const host of HOSTS) {
    try {
      const res = await fetch(`${host}/stocks.json`, { headers: UA });
      if (!res.ok) continue;
      const json = await res.json();
      const stocks = json?.stocks ?? [];
      if (stocks.length === 0) continue;
      const map = new Map<string, Quote>();
      for (const s of stocks) {
        map.set(s.symbol, {
          symbol: s.symbol,
          name: s.name,
          price: s.price?.amount ?? 0,
          change1d: s.percentChange ?? 0,
          volume: s.volume ?? 0,
        });
      }
      return map;
    } catch {
      // try next host
    }
  }
  throw new Error('phisix: could not fetch market snapshot');
}
