export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Technicals {
  rsi14: number;
  macd: { macd: number; signal: number; histogram: number };
  sma20: number;
  sma50: number;
  sma200: number;
  currentPrice: number;
  priceChange1d: number;
  priceChange1w: number;
}

export interface Fundamentals {
  pe: number | null;
  eps: number | null;
  revenue: number | null;
  bookValue: number | null;
  dividendYield: number | null;
}

export interface StockAnalysisInput {
  ticker: string;
  companyName: string;
  priceHistory: OHLCV[];
  technicals: Technicals;
  fundamentals: Fundamentals;
  headlines: string[];
}

export type Verdict = 'BUY' | 'SELL' | 'HOLD';

export interface StockAnalysisResult {
  verdict: Verdict;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
  targetPrice: number | null;
  stopLoss: number | null;
  provider: string;
  analyzedAt: string;
}
