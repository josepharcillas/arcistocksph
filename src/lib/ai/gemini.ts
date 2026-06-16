import type { StockAnalysisInput, StockAnalysisResult } from './types';
import { buildPrompt, parseAIResponse } from './prompt';

export async function analyzeWithGemini(data: StockAnalysisInput): Promise<StockAnalysisResult> {
  const apiKey = import.meta.env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(data) }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
      }),
    }
  );

  if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return { ...parseAIResponse(text), provider: 'gemini' };
}
