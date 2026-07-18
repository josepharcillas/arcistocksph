import type { StockAnalysisInput, StockAnalysisResult } from './types';
import { buildPrompt, parseAIResponse } from './prompt';

// xAI's Grok (api.x.ai) — NOT Groq (api.groq.com). The API is OpenAI-compatible,
// so this mirrors the Groq provider with a different base URL + bearer key.
// Sits between Gemini and Groq in the fallback chain (see index.ts).
export async function analyzeWithGrok(data: StockAnalysisInput): Promise<StockAnalysisResult> {
  const apiKey =
    import.meta.env.XAI_API_KEY ?? process.env.XAI_API_KEY ??
    import.meta.env.GROK_API_KEY ?? process.env.GROK_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set');

  // Override with XAI_MODEL if xAI retires/renames it.
  const model = import.meta.env.XAI_MODEL ?? process.env.XAI_MODEL ?? 'grok-3';

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: buildPrompt(data) }],
      temperature: 0.3,
      max_tokens: 512,
      response_format: { type: 'json_object' }, // force valid JSON — avoids parse fallbacks
    }),
  });

  if (!response.ok) throw new Error(`Grok API error: ${response.status} ${await response.text().catch(() => '')}`);

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content ?? '';
  return { ...parseAIResponse(text), provider: 'grok' };
}
