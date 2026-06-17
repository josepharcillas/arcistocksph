import type { StockAnalysisInput } from '../ai/types';
import { fetchPriceHistory, fetchFundamentals } from './pseedge';
import { fetchQuote, fetchAllQuotes } from './phisix';
import { computeTechnicals } from './indicators';
import { fetchHeadlines } from './news';

export { fetchPriceHistory, fetchFundamentals } from './pseedge';
export { fetchQuote, fetchAllQuotes } from './phisix';
export { computeTechnicals, computeRSI, computeMACD, computeSMA } from './indicators';
export { fetchHeadlines } from './news';

export async function getStockData(ticker: string, companyName = ticker): Promise<StockAnalysisInput> {
  const [historyR, quoteR, fundR, newsR] = await Promise.allSettled([
    fetchPriceHistory(ticker, 300), // PSE Edge: ~250 trading days, enough for SMA200
    fetchQuote(ticker), // phisix: live price/%change
    fetchFundamentals(ticker),
    fetchHeadlines(ticker, companyName),
  ]);

  const history = historyR.status === 'fulfilled' ? historyR.value : [];
  const closes = history.map((d) => d.close);

  const baseIndicators = closes.length > 0
    ? computeTechnicals(closes)
    : { rsi14: 50, macd: { macd: 0, signal: 0, histogram: 0 }, sma20: 0, sma50: 0, sma200: 0 };

  const quote = quoteR.status === 'fulfilled' ? quoteR.value : null;
  const lastClose = closes[closes.length - 1] ?? 0;
  const currentPrice = quote?.price ?? lastClose;
  const prev1w = closes[closes.length - 6] ?? currentPrice;

  // Prefer the live quote's %change; fall back to last-two closes from history.
  const prev1d = closes[closes.length - 2] ?? currentPrice;
  const priceChange1d = quote?.change1d ?? (prev1d > 0 ? ((currentPrice - prev1d) / prev1d) * 100 : 0);

  return {
    ticker,
    companyName,
    priceHistory: history,
    technicals: {
      ...baseIndicators,
      currentPrice,
      priceChange1d,
      priceChange1w: prev1w > 0 ? ((currentPrice - prev1w) / prev1w) * 100 : 0,
    },
    fundamentals: fundR.status === 'fulfilled'
      ? fundR.value
      : { pe: null, eps: null, revenue: null, bookValue: null, dividendYield: null, marketCap: null, outstandingShares: null },
    headlines: newsR.status === 'fulfilled' ? newsR.value : [],
  };
}
