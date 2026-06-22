// Pure helper for judging whether a past signal turned out directionally correct,
// given the return since the signal. Extracted so it can be unit-tested.
//   BUY  correct if the price rose
//   SELL correct if the price fell
//   HOLD correct if the price stayed within ±holdBand
export function isSignalCorrect(verdict: string, ret: number, holdBand = 0.03): boolean {
  if (verdict === 'BUY') return ret > 0;
  if (verdict === 'SELL') return ret < 0;
  return Math.abs(ret) <= holdBand;
}
