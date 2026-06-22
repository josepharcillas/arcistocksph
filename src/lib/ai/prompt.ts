import type { StockAnalysisInput, StockAnalysisResult, Verdict } from './types';

export function buildPrompt(data: StockAnalysisInput): string {
  const { ticker, companyName, technicals, fundamentals, headlines } = data;
  const t = technicals;

  return `You are a disciplined, skeptical equity analyst for the Philippine Stock Exchange (PSE). Give a BUY, SELL, or HOLD call — but be balanced and avoid a bullish bias.

CALIBRATION RULES (follow strictly):
- Match the call to the evidence — do NOT have a standing bias toward BUY or toward HOLD.
- Weigh bullish and bearish evidence equally:
  - Bullish: price above rising SMA20/50, positive MACD histogram, RSI rebounding from <30, positive news.
  - Bearish: price below SMA50/200, negative MACD histogram, RSI > 70 (overbought) or rolling over, negative news, rich valuation.
- Make a directional call (BUY or SELL) when the technicals lean one way, even if fundamentals are N/A — use trend + momentum to decide. Reserve HOLD for genuinely mixed/conflicting signals, not as a default escape.
- Confidence reflects evidence strength, not enthusiasm:
  - HIGH = trend, momentum, AND (fundamentals or news) all agree. With fundamentals N/A, HIGH should be rare.
  - MEDIUM = the technicals clearly lean one way but confirmation is partial or data is missing.
  - LOW = signals conflict or the move is marginal.
- targetPrice/stopLoss should be realistic levels derived from the price and SMAs, or null if you can't justify them.

STOCK: ${ticker} (${companyName})

TECHNICALS:
- Current Price: ₱${t.currentPrice.toFixed(2)}
- RSI (14): ${t.rsi14.toFixed(1)} ${t.rsi14 > 70 ? '(overbought)' : t.rsi14 < 30 ? '(oversold)' : '(neutral)'}
- MACD: ${t.macd.macd.toFixed(4)} | Signal: ${t.macd.signal.toFixed(4)} | Histogram: ${t.macd.histogram.toFixed(4)}
- SMA 20: ₱${t.sma20.toFixed(2)} | SMA 50: ₱${t.sma50.toFixed(2)} | SMA 200: ₱${t.sma200.toFixed(2)}
- 1-day change: ${t.priceChange1d >= 0 ? '+' : ''}${t.priceChange1d.toFixed(2)}%
- 1-week change: ${t.priceChange1w >= 0 ? '+' : ''}${t.priceChange1w.toFixed(2)}%

FUNDAMENTALS:
- Market Cap: ${fundamentals.marketCap != null ? '₱' + (fundamentals.marketCap / 1e9).toFixed(2) + 'B' : 'N/A'}
- P/E Ratio: ${fundamentals.pe ?? 'N/A'}
- Book Value: ${fundamentals.bookValue != null ? '₱' + fundamentals.bookValue.toFixed(2) : 'N/A'}
- Dividend Yield: ${fundamentals.dividendYield != null ? fundamentals.dividendYield.toFixed(2) + '%' : 'N/A'}

RECENT NEWS:
${headlines.length > 0 ? headlines.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join('\n') : 'No recent news found.'}

Respond ONLY in this exact JSON format:
{
  "verdict": "BUY" | "SELL" | "HOLD",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "rationale": "2-3 sentence explanation in plain English, Filipino-friendly tone. Explain why without jargon.",
  "targetPrice": number or null,
  "stopLoss": number or null
}`;
}

export function parseAIResponse(text: string): Omit<StockAnalysisResult, 'provider'> {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return fallbackResult();

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const validVerdicts: Verdict[] = ['BUY', 'SELL', 'HOLD'];
    return {
      verdict: validVerdicts.includes(parsed.verdict) ? parsed.verdict : 'HOLD',
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(parsed.confidence) ? parsed.confidence : 'LOW',
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'Analysis unavailable.',
      targetPrice: typeof parsed.targetPrice === 'number' ? parsed.targetPrice : null,
      stopLoss: typeof parsed.stopLoss === 'number' ? parsed.stopLoss : null,
      analyzedAt: new Date().toISOString(),
    };
  } catch {
    return fallbackResult();
  }
}

function fallbackResult(): Omit<StockAnalysisResult, 'provider'> {
  return {
    verdict: 'HOLD',
    confidence: 'LOW',
    rationale: 'Analysis could not be completed at this time. Please try again.',
    targetPrice: null,
    stopLoss: null,
    analyzedAt: new Date().toISOString(),
  };
}
