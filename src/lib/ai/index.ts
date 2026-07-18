import type { StockAnalysisInput, StockAnalysisResult } from './types';
import { analyzeWithGemini } from './gemini';
import { analyzeWithGrok } from './grok';
import { analyzeWithGroq } from './groq';

export type { StockAnalysisInput, StockAnalysisResult, Verdict, OHLCV, Technicals, Fundamentals } from './types';

// Resolve secrets at runtime: import.meta.env is inlined at build (and the AI
// keys are not present in the deploy build), so fall back to process.env which
// the Node server reads from the live environment.
function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

// Provider fallback chain, tried in order. A provider is only attempted when at
// least one of its keys is set; if it throws (quota, outage, no credits), we drop
// to the next one. Gemini is primary (free + multi-key), then xAI Grok, then Groq.
const CHAIN: { name: string; keys: string[]; run: (d: StockAnalysisInput) => Promise<StockAnalysisResult> }[] = [
  { name: 'Gemini', keys: ['GEMINI_API_KEY', 'GEMINI_API_KEYS'], run: analyzeWithGemini },
  { name: 'Grok', keys: ['XAI_API_KEY', 'GROK_API_KEY'], run: analyzeWithGrok },
  { name: 'Groq', keys: ['GROQ_API_KEY'], run: analyzeWithGroq },
];

export async function analyzeStock(data: StockAnalysisInput): Promise<StockAnalysisResult> {
  const available = CHAIN.filter((p) => p.keys.some((k) => !!env(k)));
  if (available.length === 0) {
    throw new Error('No AI provider configured. Set GEMINI_API_KEY, XAI_API_KEY, or GROQ_API_KEY in .env');
  }

  let lastErr: unknown;
  for (let i = 0; i < available.length; i++) {
    try {
      return await available[i].run(data);
    } catch (err) {
      lastErr = err;
      const next = available[i + 1];
      if (next) console.warn(`${available[i].name} failed, falling back to ${next.name}:`, err);
      else console.error(`${available[i].name} failed and no AI providers remain:`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All AI providers failed');
}
