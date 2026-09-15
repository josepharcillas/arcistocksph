import type { APIRoute } from 'astro';
import { parsePortfolioScreenshot } from '../../../lib/ai/parsePortfolioImage';

// Parse a COL Financial portfolio screenshot into structured positions + cash.
// Server-side because it uses the Gemini API key (absent from the client build).
// This endpoint ONLY parses — it does not touch the DB. The client reviews the
// result and performs the holdings sync itself (same pattern as manual add).

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // ~8MB decoded — plenty for a screenshot
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export const POST: APIRoute = async ({ request }) => {
  try {
    const { imageBase64, mimeType } = await request.json();

    if (typeof imageBase64 !== 'string' || !imageBase64) {
      return json({ error: 'imageBase64 is required' }, 400);
    }
    if (typeof mimeType !== 'string' || !ALLOWED_MIME.has(mimeType)) {
      return json({ error: 'Unsupported image type. Use PNG, JPEG, or WebP.' }, 400);
    }
    // base64 expands ~4/3; approximate decoded size to reject oversized uploads early.
    if (imageBase64.length * 0.75 > MAX_IMAGE_BYTES) {
      return json({ error: 'Image too large. Please upload a screenshot under 8MB.' }, 413);
    }

    const result = await parsePortfolioScreenshot(imageBase64, mimeType);

    if (result.positions.length === 0) {
      return json(
        { error: 'No stock positions could be read from that screenshot. Make sure it clearly shows your COL holdings, or add them manually.' },
        422
      );
    }

    return json(result, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, 500);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
