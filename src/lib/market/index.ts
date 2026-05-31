import type { StockAnalysisInput } from '../ai/types';
import { fetchPriceHistory } from './yahoo';
import { computeTechnicals } from './indicators';
import { fetchFundamentals } from './pseedge';
import { fetchHeadlines } from './news';

export { fetchPriceHistory, fetchQuote } from './yahoo';
export { computeTechnicals, computeRSI, computeMACD, computeSMA } from './indicators';
export { fetchFundamentals } from './pseedge';
export { fetchHeadlines } from './news';

export async function getStockData(ticker: string, companyName = ticker): Promise<StockAnalysisInput> {
  const [priceHistory, fundamentals, headlines] = await Promise.allSettled([
    fetchPriceHistory(ticker, 200),
    fetchFundamentals(ticker),
    fetchHeadlines(ticker, companyName),
  ]);

  const history = priceHistory.status === 'fulfilled' ? priceHistory.value : [];
  const closes = history.map(d => d.close);

  const baseIndicators = closes.length > 0
    ? computeTechnicals(closes)
    : { rsi14: 50, macd: { macd: 0, signal: 0, histogram: 0 }, sma20: 0, sma50: 0, sma200: 0 };

  const currentPrice = closes[closes.length - 1] ?? 0;
  const prev1d = closes[closes.length - 2] ?? currentPrice;
  const prev1w = closes[closes.length - 6] ?? currentPrice;

  return {
    ticker,
    companyName,
    priceHistory: history,
    technicals: {
      ...baseIndicators,
      currentPrice,
      priceChange1d: prev1d > 0 ? ((currentPrice - prev1d) / prev1d) * 100 : 0,
      priceChange1w: prev1w > 0 ? ((currentPrice - prev1w) / prev1w) * 100 : 0,
    },
    fundamentals: fundamentals.status === 'fulfilled' ? fundamentals.value : { pe: null, eps: null, revenue: null, bookValue: null, dividendYield: null },
    headlines: headlines.status === 'fulfilled' ? headlines.value : [],
  };
}
