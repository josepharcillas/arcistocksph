import type { APIRoute } from 'astro';
import { analyzeStock } from '../../lib/ai';
import { getStockData } from '../../lib/market';
import { createSupabaseAdmin } from '../../lib/supabase-admin';
import { isPushConfigured, notifyHoldersOfSignal } from '../../lib/push/send';
import type { StockAnalysisResult } from '../../lib/ai/types';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — shared across users via DB

export const POST: APIRoute = async ({ request }) => {
  try {
    const { ticker, companyName } = await request.json();
    if (!ticker) return new Response(JSON.stringify({ error: 'ticker is required' }), { status: 400 });

    const sym = ticker.toUpperCase().replace('.PS', '');
    const admin = createSupabaseAdmin();

    // L1: shared DB cache (signal_cache) — avoids re-calling the AI on every visit
    const { data: cached } = await admin.from('signal_cache').select('*').eq('ticker', sym).maybeSingle();
    if (cached && Date.now() - new Date(cached.computed_at).getTime() < CACHE_TTL_MS) {
      const result: StockAnalysisResult & { cached: boolean } = {
        verdict: cached.verdict,
        confidence: cached.confidence,
        rationale: cached.rationale,
        targetPrice: cached.target_price,
        stopLoss: cached.stop_loss,
        provider: cached.provider,
        analyzedAt: cached.computed_at,
        cached: true,
      };
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    const stockData = await getStockData(sym, companyName ?? sym);
    const result = await analyzeStock(stockData);

    await admin.from('signal_cache').upsert({
      ticker: sym,
      verdict: result.verdict,
      confidence: result.confidence,
      rationale: result.rationale,
      target_price: result.targetPrice,
      stop_loss: result.stopLoss,
      provider: result.provider,
      computed_at: new Date().toISOString(),
    });

    // TASK-043: when a stock newly flips to SELL, notify its holders. Only on the
    // transition (not every recompute) to avoid repeat alerts, and only when push
    // is configured. Fire-and-forget so it never delays or fails the response.
    if (result.verdict === 'SELL' && cached?.verdict !== 'SELL' && isPushConfigured()) {
      notifyHoldersOfSignal(sym, result.verdict, result.rationale).catch((err) =>
        console.warn('push notify failed:', err instanceof Error ? err.message : err)
      );
    }

    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
