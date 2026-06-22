// Portfolio-aware advisor — pure risk-managed recommendation logic.
// Given current positions (with live price + signal), available cash, and a
// concentration cap, produce an ordered set of actions. Deterministic and
// explainable on purpose: no price prediction, just risk + signal rules.
// See docs/brainstorms/2026-06-22-portfolio-advisor-requirements.md.

export type Verdict = 'BUY' | 'SELL' | 'HOLD';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AdvisorPosition {
  ticker: string;
  shares: number;       // 0 for a watchlist candidate not yet held
  avgCost: number;
  price: number;
  verdict: Verdict | null;
  confidence: Confidence | null;
  stopLoss?: number | null; // from the signal; enables risk-based sizing
}

export interface AdvisorConfig {
  maxWeightPct: number;   // concentration cap, % of equity
  deepLossPct: number;    // P/L threshold (negative) at which a SELL triggers EXIT
  sizing: 'cap' | 'risk'; // how BUY size is computed
  riskPerTradePct: number; // % of equity risked to the stop-loss (risk mode)
}

export const DEFAULT_ADVISOR_CONFIG: AdvisorConfig = {
  maxWeightPct: 30, deepLossPct: -40, sizing: 'cap', riskPerTradePct: 2,
};

export type ActionKind = 'EXIT' | 'TRIM' | 'BUY' | 'HOLD_CASH';

export interface AdvisorAction {
  kind: ActionKind;
  ticker?: string;
  shares?: number;
  pesos?: number; // cost for BUY; proceeds for EXIT/TRIM; remaining cash for HOLD_CASH
  reason: string;
}

export interface PositionView {
  ticker: string;
  value: number;
  weightPct: number;
  pnlPct: number;
  verdict: Verdict | null;
  isHolding: boolean;
}

export interface Advice {
  equity: number;
  cash: number;
  holdingsValue: number;
  positions: PositionView[];
  actions: AdvisorAction[];
}

const confRank = (c: Confidence | null): number =>
  c === 'HIGH' ? 3 : c === 'MEDIUM' ? 2 : c === 'LOW' ? 1 : 0;

const peso = (n: number): string => n.toLocaleString('en-PH', { maximumFractionDigits: 0 });

export function computeAdvice(
  positions: AdvisorPosition[],
  cash: number,
  config: AdvisorConfig = DEFAULT_ADVISOR_CONFIG
): Advice {
  const valued = positions.map((p) => {
    const value = p.shares * p.price;
    const pnlPct = p.avgCost > 0 ? ((p.price - p.avgCost) / p.avgCost) * 100 : 0;
    return { ...p, value, pnlPct };
  });
  // Equity counts only held value (watchlist candidates have shares 0 → value 0).
  const holdingsValue = valued.reduce((s, p) => s + p.value, 0);
  const equity = cash + holdingsValue;
  const withWeight = valued.map((p) => ({ ...p, weightPct: equity > 0 ? (p.value / equity) * 100 : 0 }));

  const actions: AdvisorAction[] = [];
  let freed = 0;
  const exited = new Set<string>();

  // --- Sell / trim pass: cut dead losses and over-concentration, freeing cash ---
  for (const p of withWeight) {
    if (p.shares <= 0) continue; // can't sell what you don't hold
    if (p.verdict === 'SELL' && p.pnlPct <= config.deepLossPct) {
      actions.push({
        kind: 'EXIT', ticker: p.ticker, shares: p.shares, pesos: p.value,
        reason: `Down ${p.pnlPct.toFixed(0)}% with a SELL signal — cut the loss and free ₱${peso(p.value)}.`,
      });
      freed += p.value;
      exited.add(p.ticker);
    } else if (p.weightPct > config.maxWeightPct) {
      const targetValue = (config.maxWeightPct / 100) * equity;
      const trimShares = Math.floor((p.value - targetValue) / p.price);
      if (trimShares >= 1) {
        const proceeds = trimShares * p.price;
        actions.push({
          kind: 'TRIM', ticker: p.ticker, shares: trimShares, pesos: proceeds,
          reason: `${p.weightPct.toFixed(0)}% of your book (cap ${config.maxWeightPct}%) — trim ${trimShares} share(s) to cut concentration, frees ₱${peso(proceeds)}.`,
        });
        freed += proceeds;
      }
    }
  }

  // --- Buy pass: deploy available + freed cash into the best under-cap BUY ---
  let available = cash + freed;
  const riskBudget = (config.riskPerTradePct / 100) * equity;
  const candidates = withWeight
    .filter((p) => p.verdict === 'BUY' && p.weightPct < config.maxWeightPct && !exited.has(p.ticker))
    .sort((a, b) => confRank(b.confidence) - confRank(a.confidence) || a.weightPct - b.weightPct);

  for (const p of candidates) {
    if (available < p.price) continue;
    const capRoom = Math.max(0, (config.maxWeightPct / 100) * equity - p.value);
    const capShares = Math.floor(capRoom / p.price);
    const cashShares = Math.floor(available / p.price);

    // Risk-based sizing when a usable stop-loss exists; else cap/cash bound only.
    const usableStop = config.sizing === 'risk' && p.stopLoss != null && p.stopLoss > 0 && p.stopLoss < p.price;
    const riskShares = usableStop ? Math.floor(riskBudget / (p.price - p.stopLoss!)) : Infinity;

    const shares = Math.min(capShares, cashShares, riskShares);
    if (shares >= 1) {
      const cost = shares * p.price;
      const basis = usableStop
        ? `risk ${config.riskPerTradePct}% of equity to a ₱${p.stopLoss!.toFixed(2)} stop`
        : `under the ${config.maxWeightPct}% cap`;
      actions.push({
        kind: 'BUY', ticker: p.ticker, shares, pesos: cost,
        reason: `${p.verdict}/${p.confidence ?? '—'} signal — add ${shares} share(s) for ₱${peso(cost)} (${basis}).`,
      });
      available -= cost;
    }
  }

  if (!actions.some((a) => a.kind === 'BUY')) {
    actions.push({
      kind: 'HOLD_CASH', pesos: available,
      reason: candidates.length === 0
        ? `No stock has a BUY signal under the ${config.maxWeightPct}% cap — hold your ₱${peso(available)} cash.`
        : `Not enough cash to add a meaningful position — hold ₱${peso(available)}.`,
    });
  }

  return {
    equity,
    cash,
    holdingsValue,
    positions: withWeight.map((p) => ({
      ticker: p.ticker, value: p.value, weightPct: p.weightPct, pnlPct: p.pnlPct,
      verdict: p.verdict, isHolding: p.shares > 0,
    })),
    actions,
  };
}

// Headline action = the first real (non-HOLD_CASH) recommendation, used for alert
// dedup. Returns a stable signature string, or null when the only advice is to hold.
export function headlineSignature(advice: Advice): string | null {
  const top = advice.actions.find((a) => a.kind !== 'HOLD_CASH');
  if (!top) return null;
  return `${top.kind}:${top.ticker}:${top.shares ?? 0}`;
}
