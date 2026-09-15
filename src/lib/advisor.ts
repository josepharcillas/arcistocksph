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
  isNew?: boolean;      // market-discovered opportunity (not held, not watchlisted)
}

export interface AdvisorConfig {
  maxWeightPct: number;   // concentration cap, % of equity
  deepLossPct: number;    // P/L threshold (negative) at which a SELL triggers EXIT
  sizing: 'cap' | 'risk'; // how BUY size is computed
  riskPerTradePct: number; // % of equity risked to the stop-loss (risk mode)
  maxPositions: number;   // no NEW entries once this many tickers are held
}

export const DEFAULT_ADVISOR_CONFIG: AdvisorConfig = {
  maxWeightPct: 30, deepLossPct: -40, sizing: 'cap', riskPerTradePct: 2, maxPositions: 10,
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

  // Position-count cap: adds to existing holdings are always allowed, but NEW
  // entries stop once the book is already maxPositions tickers wide — an LLM
  // given the whole market will otherwise "diversify" into correlation risk
  // and fee bleed one plausible-sounding name at a time.
  let openPositions = withWeight.filter((p) => p.shares > 0 && !exited.has(p.ticker)).length;

  for (const p of candidates) {
    if (available < p.price) continue;
    if (p.shares <= 0 && openPositions >= config.maxPositions) continue;
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
      const lead = p.isNew ? 'New opportunity from the market scan: ' : '';
      actions.push({
        kind: 'BUY', ticker: p.ticker, shares, pesos: cost,
        reason: `${lead}${p.verdict}/${p.confidence ?? '—'} signal — add ${shares} share(s) for ₱${peso(cost)} (${basis}).`,
      });
      available -= cost;
      if (p.shares <= 0) openPositions++;
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

// ---------------------------------------------------------------------------
// Deploy-cash planner — "I have ₱X new cash today, split it for me."
// Separate from computeAdvice on purpose: the advisor-alerts cron keeps the
// greedy single-name buy logic, while this planner serves the recurring-deposit
// (peso-cost-averaging) user by SPREADING a fixed deposit across several names.
// ---------------------------------------------------------------------------

// PSE board-lot table: the minimum tradeable share increment at a given price.
// Real orders must be whole multiples of this, so buys round DOWN to it —
// "buy 37 shares" of a ₱1,250 stock is an unplaceable order.
export function boardLot(price: number): number {
  if (price < 0.01) return 1_000_000;
  if (price < 0.05) return 100_000;
  if (price < 0.5) return 10_000;
  if (price < 5) return 1_000;
  if (price < 50) return 100;
  if (price < 200) return 10;
  return 5;
}

// Dividend blue chips used as the fallback when there are few/no signal BUYs
// (mirrors the DCA bot's universe — telcos, banks, power, REITs; deliberately
// skips max-yield cyclicals). Defined here so the client planner can use it
// without importing the server-only bot module.
export const DIVIDEND_BLUE_CHIPS = ['TEL', 'GLO', 'BDO', 'BPI', 'MBT', 'AP', 'MER', 'AREIT', 'RCR'];

export interface DeployCandidate {
  ticker: string;
  price: number;
  heldValue: number;                 // peso value already held (0 if none)
  source: 'signal' | 'dividend';
  verdict?: Verdict | null;
  confidence?: Confidence | null;
}

export interface DeployBuy {
  ticker: string;
  shares: number;
  pesos: number;
  lotSize: number;
  source: 'signal' | 'dividend';
  reason: string;
}

export interface DeployPlan {
  deposit: number;
  deployed: number;
  leftover: number;
  buys: DeployBuy[];
  note: string;
}

export interface DeployOptions {
  targetNames?: number;   // how many names to spread across (default 4)
  maxWeightPct?: number;  // concentration cap vs equity (default from config)
}

// Turn "I have ₱deposit new cash" into a diversified, board-lot-valid buy list.
// Spreads across up to targetNames names (signal BUYs first, then dividend blue
// chips to fill), each capped to a share of the deposit AND to the concentration
// cap, then tops up leftover into the most-underweight affordable name. Never
// lumps the whole deposit into one stock; only "holds cash" when literally
// nothing is affordable within the deposit.
export function computeDeployPlan(
  candidates: DeployCandidate[],
  deposit: number,
  equity: number,
  opts: DeployOptions = {},
): DeployPlan {
  const targetNames = Math.max(1, opts.targetNames ?? 4);
  const maxWeightPct = opts.maxWeightPct ?? DEFAULT_ADVISOR_CONFIG.maxWeightPct;

  const lotCostOf = (c: DeployCandidate) => boardLot(c.price) * c.price;
  const capRoom0 = (c: DeployCandidate) =>
    equity > 0 ? Math.max(0, (maxWeightPct / 100) * equity - c.heldValue) : Infinity;

  // Only names where at least one whole board lot fits BOTH the deposit and the
  // concentration cap are buyable — otherwise the slot is wasted on a name we
  // can never place (e.g. a ₱1,250 stock whose ₱6,250 lot blows the 30% cap).
  const usable = candidates.filter((c) => c.price > 0 && lotCostOf(c) <= deposit && lotCostOf(c) <= capRoom0(c));
  // Signal BUYs lead (they cleared the quality gates); then most-underweight
  // (equal-weight building); then cheapest lot first so we can spread widely.
  const groupRank = (c: DeployCandidate) => (c.source === 'signal' ? 0 : 1);
  const ordered = [...usable].sort(
    (a, b) => groupRank(a) - groupRank(b) || a.heldValue - b.heldValue || lotCostOf(a) - lotCostOf(b),
  );
  const selected = ordered.slice(0, targetNames);

  const noneNote = 'Nothing is affordable within this deposit right now — hold the cash for next time.';
  if (selected.length === 0) {
    return { deposit, deployed: 0, leftover: deposit, buys: [], note: noneNote };
  }

  const bought = new Map<string, { shares: number; pesos: number; c: DeployCandidate }>();
  let remaining = deposit;

  // Round-robin: buy ONE board lot from each selected name per pass, so the
  // deposit spreads evenly and deploys as fully as board lots + the cap allow,
  // instead of lumping into the first name or stranding cash.
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (const c of selected) {
      const lot = boardLot(c.price);
      const lotCost = lot * c.price;
      const addedPesos = bought.get(c.ticker)?.pesos ?? 0;
      const capRoom = equity > 0 ? Math.max(0, (maxWeightPct / 100) * equity - c.heldValue - addedPesos) : Infinity;
      if (lotCost > remaining || lotCost > capRoom) continue;
      remaining -= lotCost;
      const existing = bought.get(c.ticker);
      if (existing) { existing.shares += lot; existing.pesos += lotCost; }
      else bought.set(c.ticker, { shares: lot, pesos: lotCost, c });
      progressed = true;
    }
  }

  const buys: DeployBuy[] = [...bought.values()].map(({ shares, pesos, c }) => {
    const reason = c.source === 'signal'
      ? `AI BUY signal${c.confidence ? ` (${c.confidence.toLowerCase()} confidence)` : ''} — buy ${shares.toLocaleString('en-PH')} sh for ₱${peso(pesos)}.`
      : `Dividend blue chip — evens out your holdings. Buy ${shares.toLocaleString('en-PH')} sh for ₱${peso(pesos)}.`;
    return { ticker: c.ticker, shares, pesos, lotSize: boardLot(c.price), source: c.source, reason };
  }).sort((a, b) => b.pesos - a.pesos);

  const deployed = buys.reduce((s, b) => s + b.pesos, 0);
  const leftover = deposit - deployed;
  const note = buys.length === 0
    ? noneNote
    : `Spreads ₱${peso(deployed)} across ${buys.length} name${buys.length === 1 ? '' : 's'}; ₱${peso(leftover)} left as cash (below one board lot).`;

  return { deposit, deployed, leftover, buys, note };
}

// Headline action = the first real (non-HOLD_CASH) recommendation, used for alert
// dedup. Returns a stable signature string, or null when the only advice is to hold.
export function headlineSignature(advice: Advice): string | null {
  const top = advice.actions.find((a) => a.kind !== 'HOLD_CASH');
  if (!top) return null;
  return `${top.kind}:${top.ticker}:${top.shares ?? 0}`;
}
