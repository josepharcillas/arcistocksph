import type { StockAnalysisInput, StockAnalysisResult } from './types';
import { buildPrompt, parseAIResponse } from './prompt';

// gemini-1.5/2.5-flash are retired or closed to new API keys; default to the
// always-current flash alias (good reasoning + high enough rate limits for the
// bot's many calls). Override with GEMINI_MODEL, e.g. gemini-2.5-pro for max
// reasoning or gemini-3.5-flash.
const MODEL = import.meta.env.GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-flash-latest';

// Multiple keys are supported: set GEMINI_API_KEY (or GEMINI_API_KEYS) to a
// comma- or whitespace-separated list. The free tier is ~20 requests/day PER
// key, so rotating across N keys multiplies the daily budget. Each call starts
// at a round-robin offset (spreads load) and fails over to the next key on a
// quota/5xx error before the caller drops to Groq.
function geminiKeys(): string[] {
  const raw =
    import.meta.env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ??
    import.meta.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEYS ?? '';
  return String(raw).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

let rrCursor = 0; // round-robin start so we don't always exhaust the first key

export async function analyzeWithGemini(data: StockAnalysisInput): Promise<StockAnalysisResult> {
  const keys = geminiKeys();
  if (keys.length === 0) throw new Error('GEMINI_API_KEY not set');

  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildPrompt(data) }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      // Force clean JSON output (no markdown fences).
      responseMimeType: 'application/json',
      // 2.5+ models "think" by default, which would consume the output budget
      // and return empty text — disable it so we get the JSON directly.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const start = rrCursor++ % keys.length;
  let lastErr: Error | null = null;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
      );

      // Quota exhausted (429) or a transient server error — try the next key.
      if (response.status === 429 || response.status >= 500) {
        lastErr = new Error(`Gemini API error: ${response.status} ${await response.text().catch(() => '')}`);
        if (keys.length > 1) console.warn(`[gemini] key ${keyLabel(key)} returned ${response.status}, trying next key`);
        continue;
      }
      // Other 4xx (bad request, invalid model/key) fail the same way for every
      // key of the same project — don't burn the rest, surface it now.
      if (!response.ok) throw new Error(`Gemini API error: ${response.status} ${await response.text().catch(() => '')}`);

      const json = await response.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return { ...parseAIResponse(text), provider: 'gemini' };
    } catch (err) {
      // Network/fetch failure — record and try the next key.
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastErr ?? new Error('Gemini: all keys failed');
}

// Never log a full key; show just enough to tell them apart in logs.
function keyLabel(key: string): string {
  return key.length <= 8 ? '***' : `…${key.slice(-4)}`;
}
