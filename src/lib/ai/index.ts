import type { StockAnalysisInput, StockAnalysisResult } from './types';
import { analyzeWithGemini } from './gemini';
import { analyzeWithGroq } from './groq';

export type { StockAnalysisInput, StockAnalysisResult, Verdict, OHLCV, Technicals, Fundamentals } from './types';

export async function analyzeStock(data: StockAnalysisInput): Promise<StockAnalysisResult> {
  const hasGemini = !!import.meta.env.GEMINI_API_KEY;
  const hasGroq = !!import.meta.env.GROQ_API_KEY;

  if (!hasGemini && !hasGroq) {
    throw new Error('No AI provider configured. Set GEMINI_API_KEY or GROQ_API_KEY in .env');
  }

  if (hasGemini) {
    try {
      return await analyzeWithGemini(data);
    } catch (err) {
      if (!hasGroq) throw err;
      console.warn('Gemini failed, falling back to Groq:', err);
    }
  }

  return await analyzeWithGroq(data);
}
