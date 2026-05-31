import type { StockAnalysisInput, StockAnalysisResult } from './types';
import { buildPrompt, parseAIResponse } from './prompt';

export async function analyzeWithGroq(data: StockAnalysisInput): Promise<StockAnalysisResult> {
  const apiKey = import.meta.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: buildPrompt(data) }],
      temperature: 0.3,
      max_tokens: 512,
    }),
  });

  if (!response.ok) throw new Error(`Groq API error: ${response.status}`);

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content ?? '';
  return { ...parseAIResponse(text), provider: 'groq' };
}
