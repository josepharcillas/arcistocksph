// Pure mean-reversion "buy the dip" logic (no IO) — unit-tested in bounceLogic.test.ts.
//
// The disciplined version of "it's washed out, it'll bounce". Reward a stock that is
// near its low AND oversold AND showing a momentum turn — but refuse to catch a
// falling knife: an AI SELL verdict is an automatic AVOID (value trap / downtrend),
// and a still-falling name (MACD below zero) is WAIT, not a buy. Mirror of
// dividendLogic.ts `entryRating`.

export type BounceRating = 'SETUP' | 'WAIT' | 'AVOID';

export interface BounceInput {
  rsi14: number | null;
  pctFromLow: number | null; // % the price sits above the trailing (~52wk) low; small = washed out
  macdHist: number | null;   // MACD histogram; >= 0 = momentum has turned up (the SETUP signal)
  aboveSma200: boolean | null;
  verdict?: string | null;   // cached AI verdict, if any
  nearLowPct?: number;       // "washed out" threshold, % above the low (default 10)
  rsiMax?: number;           // oversold gate (default 35)
}

export interface BounceResult {
  rating: BounceRating;
  score: number;
  reasons: string[];
}

/** How far (%) the current price sits above the lowest close in the series.
 *  0 = sitting right on its low. Returns null when there's no usable data. */
export function pctFromLow(closes: number[], current: number): number | null {
  const valid = closes.filter((c) => c > 0);
  if (valid.length === 0 || !(current > 0)) return null;
  const low = Math.min(...valid);
  if (!(low > 0)) return null;
  return ((current - low) / low) * 100;
}

/** Rate how much a stock looks like a genuine oversold BOUNCE right now (vs a
 *  falling knife or a value trap). */
export function bounceRating(inp: BounceInput): BounceResult {
  const nearLowPct = inp.nearLowPct ?? 10;
  const rsiMax = inp.rsiMax ?? 35;
  const reasons: string[] = [];

  // 1. Trap guard — the falling knife you don't catch. Same guard the dividend
  //    tracker uses: a SELL verdict means the market is pricing in real trouble.
  if (inp.verdict === 'SELL') {
    return { rating: 'AVOID', score: 0, reasons: ['AI signal is SELL — likely a falling knife / value trap, not a bounce'] };
  }

  const oversold = inp.rsi14 != null && inp.rsi14 <= rsiMax;
  const nearLow = inp.pctFromLow != null && inp.pctFromLow <= nearLowPct;

  // 2. Is this even a dip? Need to be oversold OR washed out near the low.
  if (!oversold && !nearLow) {
    const why = inp.rsi14 == null && inp.pctFromLow == null
      ? 'Not enough data to judge a dip'
      : 'Neither oversold nor near its low — not a dip setup';
    return { rating: 'WAIT', score: 0, reasons: [why] };
  }

  // 3. Score the depth of the washout.
  let score = 0;
  if (inp.rsi14 != null) {
    if (inp.rsi14 <= 30) { score += 2; reasons.push(`Very oversold (RSI ${inp.rsi14.toFixed(0)})`); }
    else if (inp.rsi14 <= rsiMax) { score += 1; reasons.push(`Oversold (RSI ${inp.rsi14.toFixed(0)})`); }
  }
  if (inp.pctFromLow != null) {
    if (inp.pctFromLow <= 0) { score += 2; reasons.push('At a fresh low'); }
    else if (inp.pctFromLow <= 5) { score += 2; reasons.push(`Right at its low (${inp.pctFromLow.toFixed(0)}% above)`); }
    else if (inp.pctFromLow <= nearLowPct) { score += 1; reasons.push(`Near its low (${inp.pctFromLow.toFixed(0)}% above)`); }
  }

  // 4. The turn — the line between a real SETUP and a knife still on its way down.
  const turning = inp.macdHist != null && inp.macdHist >= 0;
  if (turning) { score += 2; reasons.push('MACD turned up — downward momentum is fading'); }
  else if (inp.macdHist != null) reasons.push('MACD still falling — no turn yet');

  if (inp.aboveSma200 === true) { score += 1; reasons.push('Above the 200-day average (uptrend intact)'); }
  else if (inp.aboveSma200 === false) reasons.push('Below the 200-day average — deeper downtrend');

  // 5. Classify: a turn makes it a SETUP; still falling makes it WAIT (a knife).
  if (!turning) {
    reasons.push('Wait for a green day / the MACD to turn before calling a bottom');
    return { rating: 'WAIT', score, reasons };
  }
  return { rating: 'SETUP', score, reasons };
}
