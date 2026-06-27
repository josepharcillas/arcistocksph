import type { StockAnalysisInput, StockAnalysisResult } from './types';
import { buildPrompt, parseAIResponse } from './prompt';

// gemini-1.5-flash was retired; default to a current strong flash model (good
// reasoning + high enough rate limits for the bot's many calls). Override with
// GEMINI_MODEL, e.g. gemini-2.5-pro for max reasoning or gemini-3.5-flash.
const MODEL = import.meta.env.GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

export async function analyzeWithGemini(data: StockAnalysisInput): Promise<StockAnalysisResult> {
  const apiKey = import.meta.env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(data) }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
          // Force clean JSON output (no markdown fences).
          responseMimeType: 'application/json',
          // 2.5 models "think" by default, which would consume the output budget
          // and return empty text — disable it so we get the JSON directly.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );

  if (!response.ok) throw new Error(`Gemini API error: ${response.status} ${await response.text().catch(() => '')}`);

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return { ...parseAIResponse(text), provider: 'gemini' };
}
