# Pattern: parsing a broker screenshot with Gemini vision

**Learned:** 2026-07-06, building COL portfolio screenshot import (GH #4).

## The pattern

To turn an image (a COL Financial portfolio screenshot) into structured records,
add a **vision** call alongside the existing text-only AI provider — the shape
mirrors `src/lib/ai/gemini.ts`:

1. **Vision goes through a server API route, never the client.** The AI keys are
   server-only (absent from the client build — see `src/lib/ai/index.ts`'s
   `env()`), so the browser base64-encodes the file and POSTs it to a route
   (`src/pages/api/portfolio/import-screenshot.ts`) that does the Gemini call.
2. **Gemini vision = one extra `inline_data` part** in the same `contents[0].parts`
   array as the text prompt: `{ inline_data: { mime_type, data: base64 } }`.
   Keep `responseMimeType: 'application/json'`, `temperature: 0`, and
   `thinkingConfig: { thinkingBudget: 0 }` — the same settings that force clean
   JSON out of the 2.5 flash models for signals. This gave **exact** extraction
   of the COL EQUITIES table (ticker/shares/avg price) and even correctly derived
   avg cost `(marketValue − gain) ÷ shares` for the mobile widget that omits it.
3. **Gemini is the only wired vision provider.** The default Groq model
   (`llama-3.3-70b-versatile`) is text-only, so there's no graceful Groq fallback
   for images — throw a clear, actionable error when `GEMINI_API_KEY` is unset
   rather than silently degrading (`screenshotImportAvailable()`).

## Gotchas

- **`Number(null) === 0`, not `NaN`.** Sanitizing the model's JSON with
  `Number(obj.cash)` turned a `null` cash into `0`, which would have zeroed the
  user's real cash on sync. Guard with `typeof x === 'number'` *before* coercing.
  A unit test on the pure `parseVisionResponse` caught this — always unit-test the
  parse/sanitize step separately from the network call.
- **Validate the LLM's output, don't trust it.** `parseVisionResponse` drops rows
  with an implausible ticker (`/^[A-Z0-9]{1,6}$/`), non-positive shares/price, and
  the review UI flags tickers not in the phisix universe (`/api/stocks`, keyed on
  `symbol`). A screenshot parse is a *draft* the user confirms, never an auto-commit.
- **Scratchpad scripts can't resolve project `node_modules`.** To drive a real
  end-to-end vision test with Playwright (render a fake COL table → screenshot →
  POST → assert), the `.mjs` must live inside the repo dir, not the temp scratchpad.

## Reuse

Any "photo/screenshot → structured data" feature (e.g. importing a dividend
advice slip, a trade confirmation) follows the same route + `inline_data` +
validate-then-review shape. Reuse the sanitize-before-coerce and
draft-then-confirm discipline.
