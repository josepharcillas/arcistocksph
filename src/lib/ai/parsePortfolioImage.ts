// Vision parse of a COL Financial portfolio screenshot into structured holdings.
// Server-only: uses the Gemini API key, which is not present in the client build.
//
// Two COL layouts are supported:
//  - Web account summary  — an EQUITIES table with an explicit "Average Price"
//    column that maps straight to a position's cost basis.
//  - Mobile "Portfolio" widget — shows shares + market value + gain/loss but NO
//    average price, so cost basis is recovered as (marketValue - gain) / shares.
//
// Gemini is the only vision provider wired up (the default Groq model is text-only),
// so this throws a clear, actionable error when GEMINI_API_KEY is absent rather
// than silently degrading.

const MODEL = import.meta.env.GEMINI_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

export interface ParsedPosition {
  ticker: string;
  shares: number;
  avgPrice: number;
}

export interface ParsedPortfolio {
  positions: ParsedPosition[];
  cash: number | null;
  format: 'web' | 'mobile' | 'unknown';
}

function geminiKey(): string | undefined {
  return import.meta.env.GEMINI_API_KEY ?? process.env.GEMINI_API_KEY;
}

/** True when screenshot import is usable in the current environment. */
export function screenshotImportAvailable(): boolean {
  return !!geminiKey();
}

const PROMPT = `You are a precise data-extraction tool. The image is a screenshot of a COL Financial (Philippine Stock Exchange broker) portfolio. Extract every equity/stock position and the cash balance.

The screenshot is ONE of two layouts:
1. WEB account summary — an "EQUITIES" table with columns including Stock Code, Average Price, Total Shares, Market Value, Gain/Loss. Use "Average Price" directly as avgPrice.
2. MOBILE "Portfolio" / "STOCK HOLDINGS" widget — each row shows a ticker, "N Shares", a market value, and a gain/loss amount, but NO average price column. In that case DERIVE avgPrice = (marketValue - gainLoss) / shares, where gainLoss is negative when the row shows a loss.

Rules:
- ticker: the bare PSE stock code in uppercase (e.g. DMC, LTG, NIKL, DITO, SMC). Never include company name or exchange suffix.
- shares: integer number of shares held (strip commas).
- avgPrice: cost basis per share in PHP, to as many decimals as shown.
- Ignore mutual funds, totals rows, cash rows, and anything that is not an individual stock position.
- cash: the cash / "Actual" / "Cash Balance" amount in PHP as a number, or null if not visible.
- format: "web" or "mobile" depending on which layout you detected, else "unknown".
- If a value is unreadable, omit that position rather than guessing.

Respond ONLY with JSON in exactly this shape (no markdown, no commentary):
{
  "format": "web" | "mobile" | "unknown",
  "cash": number | null,
  "positions": [ { "ticker": "DMC", "shares": 1500, "avgPrice": 10.6313 } ]
}`;

export async function parsePortfolioScreenshot(
  imageBase64: string,
  mimeType: string
): Promise<ParsedPortfolio> {
  const apiKey = geminiKey();
  if (!apiKey) {
    throw new Error(
      'Screenshot import requires a vision AI provider. Set GEMINI_API_KEY in your environment, or add the holding manually.'
    );
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini vision error: ${response.status} ${await response.text().catch(() => '')}`);
  }

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return parseVisionResponse(text);
}

/** Parse and sanitize the model's JSON. Exported for unit testing. */
export function parseVisionResponse(text: string): ParsedPortfolio {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { positions: [], cash: null, format: 'unknown' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { positions: [], cash: null, format: 'unknown' };
  }

  const obj = parsed as Record<string, unknown>;
  const rawPositions = Array.isArray(obj.positions) ? obj.positions : [];

  const positions: ParsedPosition[] = [];
  for (const p of rawPositions) {
    const row = p as Record<string, unknown>;
    const ticker = typeof row.ticker === 'string' ? row.ticker.toUpperCase().replace(/\.PS$/, '').trim() : '';
    const shares = Number(row.shares);
    const avgPrice = Number(row.avgPrice);
    // A valid position needs a plausible ticker and positive, finite numbers.
    if (!/^[A-Z0-9]{1,6}$/.test(ticker)) continue;
    if (!Number.isFinite(shares) || shares <= 0) continue;
    if (!Number.isFinite(avgPrice) || avgPrice <= 0) continue;
    positions.push({ ticker, shares: Math.round(shares), avgPrice });
  }

  // Only coerce when cash is actually a number — Number(null) is 0, which would
  // wrongly zero out the user's cash on a screenshot where cash wasn't read.
  const cash = typeof obj.cash === 'number' && Number.isFinite(obj.cash) && obj.cash >= 0 ? obj.cash : null;
  const format = obj.format === 'web' || obj.format === 'mobile' ? obj.format : 'unknown';

  return { positions, cash, format };
}
