import type { StockAnalysisInput, StockAnalysisResult } from './types';
import { analyzeWithGemini } from './gemini';
import { analyzeWithGroq } from './groq';

export type { StockAnalysisInput, StockAnalysisResult, Verdict, OHLCV, Technicals, Fundamentals } from './types';

// Resolve secrets at runtime: import.meta.env is inlined at build (and the AI
// keys are not present in the deploy build), so fall back to process.env which
// the Node server reads from the live environment.
function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

export async function analyzeStock(data: StockAnalysisInput): Promise<StockAnalysisResult> {
  const hasGemini = !!env('GEMINI_API_KEY');
  const hasGroq = !!env('GROQ_API_KEY');

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
