// Portfolio-aware advisor — pure risk-managed recommendation logic.
// Given current positions (with live price + signal), available cash, and a
// concentration cap, produce an ordered set of actions. Deterministic and
// explainable on purpose: no price prediction, just risk + signal rules.
// See docs/brainstorms/2026-06-22-portfolio-advisor-requirements.md.

export type Verdict = 'BUY' | 'SELL' | 'HOLD';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AdvisorPosition {
  ticker: string;
  shares: number;
  avgCost: number;
  price: number;
  verdict: Verdict | null;
  confidence: Confidence | null;
}

export interface AdvisorConfig {
  maxWeightPct: number; // concentration cap, % of equity
  deepLossPct: number;  // P/L threshold (negative) at which a SELL signal triggers EXIT
}

export const DEFAULT_ADVISOR_CONFIG: AdvisorConfig = { maxWeightPct: 30, deepLossPct: -40 };

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
  const holdingsValue = valued.reduce((s, p) => s + p.value, 0);
  const equity = cash + holdingsValue;
  const withWeight = valued.map((p) => ({ ...p, weightPct: equity > 0 ? (p.value / equity) * 100 : 0 }));

  const actions: AdvisorAction[] = [];
  let freed = 0;
  const exited = new Set<string>();

  // --- Sell / trim pass: cut dead losses and over-concentration, freeing cash ---
  for (const p of withWeight) {
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
  const candidates = withWeight
    .filter((p) => p.verdict === 'BUY' && p.weightPct < config.maxWeightPct && !exited.has(p.ticker))
    .sort((a, b) => confRank(b.confidence) - confRank(a.confidence) || a.weightPct - b.weightPct);

  for (const p of candidates) {
    if (available < p.price) continue;
    const room = Math.max(0, (config.maxWeightPct / 100) * equity - p.value);
    const shares = Math.floor(Math.min(available, room) / p.price);
    if (shares >= 1) {
      const cost = shares * p.price;
      actions.push({
        kind: 'BUY', ticker: p.ticker, shares, pesos: cost,
        reason: `${p.verdict}/${p.confidence ?? '—'} signal at ${p.weightPct.toFixed(0)}% weight (under ${config.maxWeightPct}% cap) — add ${shares} share(s) for ₱${peso(cost)}.`,
      });
      available -= cost;
    }
  }

  if (!actions.some((a) => a.kind === 'BUY')) {
    actions.push({
      kind: 'HOLD_CASH', pesos: available,
      reason: candidates.length === 0
        ? `No holding has a BUY signal under the ${config.maxWeightPct}% cap — hold your ₱${peso(available)} cash.`
        : `Not enough cash to add a meaningful position — hold ₱${peso(available)}.`,
    });
  }

  return {
    equity,
    cash,
    holdingsValue,
    positions: withWeight.map((p) => ({ ticker: p.ticker, value: p.value, weightPct: p.weightPct, pnlPct: p.pnlPct, verdict: p.verdict })),
    actions,
  };
}
