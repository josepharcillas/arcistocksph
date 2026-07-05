// Shared presentation for advisor action cards (EXIT/TRIM/BUY/HOLD_CASH), used by
// the Advisor page and the Portfolio-page AI analysis card so the two can't drift.

export const actionStyle: Record<string, string> = {
  EXIT: 'border-red-500/40 bg-red-500/5',
  TRIM: 'border-amber-500/40 bg-amber-500/5',
  BUY: 'border-green-500/40 bg-green-500/5',
  HOLD_CASH: 'border-slate-700 bg-slate-800/40',
};

export const actionColor: Record<string, string> = {
  EXIT: 'text-red-400', TRIM: 'text-amber-400', BUY: 'text-green-400', HOLD_CASH: 'text-slate-400',
};

export const actionLabel: Record<string, string> = {
  EXIT: 'EXIT', TRIM: 'TRIM', BUY: 'BUY', HOLD_CASH: 'HOLD CASH',
};
