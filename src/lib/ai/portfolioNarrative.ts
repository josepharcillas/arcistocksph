// Whole-portfolio AI narrative — a plain-English read of the user's book that
// weighs concentration, winners/losers, SELL-signaled holdings, and dividend
// income/upcoming record dates. News is already folded into each stock's signal
// verdict, so this narrative inherits it via the per-position verdicts.
//
// Provider abstraction mirrors src/lib/ai/index.ts: Gemini primary, Groq fallback.
// Pure prompt-building and parsing are exported for unit testing.

export interface NarrativePosition {
  ticker: string;
  weightPct: number;
  pnlPct: number;
  verdict: string | null;
  yieldPct: number | null;       // recurring TTM dividend yield, if a known payer
  nextRecordDate: string | null; // upcoming dividend record date, if any
}

export interface PortfolioNarrativeInput {
  equity: number;
  cash: number;
  positions: NarrativePosition[];
  actions: { kind: string; ticker?: string; reason: string }[];
}

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

const peso = (n: number) => n.toLocaleString('en-PH', { maximumFractionDigits: 0 });

export function buildNarrativePrompt(input: PortfolioNarrativeInput): string {
  const { equity, cash, positions, actions } = input;
  const cashPct = equity > 0 ? (cash / equity) * 100 : 0;

  const posLines = positions.length
    ? positions
        .slice()
        .sort((a, b) => b.weightPct - a.weightPct)
        .map((p) => {
          const div = p.yieldPct != null && p.yieldPct > 0
            ? `, ${p.yieldPct.toFixed(1)}% yield${p.nextRecordDate ? ` (record date ${p.nextRecordDate})` : ''}`
            : '';
          return `- ${p.ticker}: ${p.weightPct.toFixed(0)}% of book, P/L ${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(0)}%, signal ${p.verdict ?? 'N/A'}${div}`;
        })
        .join('\n')
    : '- (no holdings)';

  const actionLines = actions.length
    ? actions.map((a) => `- ${a.kind}${a.ticker ? ' ' + a.ticker : ''}: ${a.reason}`).join('\n')
    : '- (none)';

  return `You are a disciplined, plain-spoken portfolio coach for a Filipino retail investor on the Philippine Stock Exchange. Read this portfolio and give a short, honest assessment. Be balanced — name risks (over-concentration, deep losers, SELL signals) as readily as strengths (dividend income, winners, cash on hand). Do NOT predict prices or promise returns.

PORTFOLIO
- Account equity: ₱${peso(equity)}
- Cash: ₱${peso(cash)} (${cashPct.toFixed(0)}% of equity)

POSITIONS (by weight)
${posLines}

RECOMMENDED ACTIONS (already computed by a risk model)
${actionLines}

Write 3-5 sentences of clear English (no Tagalog, no jargon without explanation). Cover, where relevant: how concentrated or diversified the book is, the biggest risk right now, any dividend income worth noting or an upcoming record date to hold for, and what the single most important next move is. Do not just restate the action list — interpret it.

Respond ONLY as JSON: { "summary": "..." }`;
}

const NARRATIVE_FALLBACK = 'A portfolio summary could not be generated right now.';

export function parseNarrative(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) return parsed.summary.trim();
      // Valid JSON but no usable summary — return the safe default rather than
      // leaking the raw JSON string to the user.
      return NARRATIVE_FALLBACK;
    } catch { /* not JSON after all — treat the whole text as prose below */ }
  }
  // The model returned prose instead of JSON — use it as-is (trimmed).
  return text.trim() || NARRATIVE_FALLBACK;
}

export interface PortfolioNarrative {
  summary: string;
  provider: string;
}

export async function analyzePortfolio(input: PortfolioNarrativeInput): Promise<PortfolioNarrative> {
  const prompt = buildNarrativePrompt(input);
  const hasGemini = !!env('GEMINI_API_KEY');
  const hasGroq = !!env('GROQ_API_KEY');
  if (!hasGemini && !hasGroq) throw new Error('No AI provider configured. Set GEMINI_API_KEY or GROQ_API_KEY.');

  if (hasGemini) {
    try {
      return { summary: await callGemini(prompt), provider: 'gemini' };
    } catch (err) {
      if (!hasGroq) throw err;
      console.warn('Gemini narrative failed, falling back to Groq:', err);
    }
  }
  return { summary: await callGroq(prompt), provider: 'groq' };
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = env('GEMINI_API_KEY')!;
  const model = env('GEMINI_MODEL') ?? 'gemini-2.5-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const json = await res.json();
  return parseNarrative(json.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

async function callGroq(prompt: string): Promise<string> {
  const apiKey = env('GROQ_API_KEY')!;
  const model = env('GROQ_MODEL') ?? 'llama-3.3-70b-versatile';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 512,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`Groq API error: ${res.status}`);
  const json = await res.json();
  return parseNarrative(json.choices?.[0]?.message?.content ?? '');
}
