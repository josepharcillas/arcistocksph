// Types for the shared pure bot-stats math (botStats.mjs), so TypeScript
// consumers (src/lib/botScoreboard.ts) get checking while the runtime stays JS.
export interface WinRateResult {
  closed: number;
  wins: number;
  realized: number;
  winRate: number | null;
}
export function winRateReplay(
  trades: Array<{ ticker: string; action: string; qty: number | string; price: number | string }> | null | undefined,
): WinRateResult;
export function alpha(botPnl: number | null | undefined, bench: number | null | undefined): number | null;
export function basketReturn(
  baseline: Record<string, number> | null | undefined,
  current: Map<string, number> | Record<string, number> | null | undefined,
): number | null;
