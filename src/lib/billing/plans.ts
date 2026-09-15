/**
 * Plans and what each one unlocks.
 *
 * ## Why access is sold as a fixed period, not a card subscription
 *
 * Most Filipinos do not pay for things online with a recurring card mandate.
 * They pay with GCash or Maya, which are push payments: the customer approves
 * one transfer, and nothing can silently charge them again next month. Building
 * this as a card-only auto-renewing subscription would exclude the majority of
 * the addressable market to save the operator a renewal email.
 *
 * So a purchase buys a definite window of access — 30 days or 365 days — that
 * expires on a date the user can see, and renewing is a deliberate act. It is
 * more honest than auto-renewal, it works with every PH payment method, and it
 * removes an entire category of billing disputes.
 *
 * ## Money
 *
 * Integer centavos everywhere, matching the rest of the estate. `299.99 * 100`
 * is `29998.999999999996` in IEEE 754, and money that drifts by a centavo is
 * money someone eventually has to reconcile by hand.
 */

export type PlanId = "free" | "pro_monthly" | "pro_annual";
export type Tier = "free" | "pro";

/**
 * A capability the app checks before doing something expensive or premium.
 *
 * Named for what the user gets, not for the component that happens to render
 * it — a flag called `showBuyIdeasPanel` becomes a lie the moment the panel
 * moves.
 */
export interface Entitlements {
  tier: Tier;
  /** AI buy/sell/hold signals with written rationale. */
  aiSignals: boolean;
  /** AI ranking on the screener, as opposed to plain numeric filters. */
  aiScreenerRank: boolean;
  /** The dip radar. */
  dipRadar: boolean;
  /** Dividend alerts and the ex-date watch. */
  dividendAlerts: boolean;
  /** AI narrative analysis over the whole portfolio. */
  portfolioInsights: boolean;
  /** Web-push alerts to the phone. */
  pushNotifications: boolean;
  /** Import holdings from a broker screenshot. */
  screenshotImport: boolean;
  /** The automated paper-trading bot. */
  autoTradeBot: boolean;
  /** How many tickers may be watched. Infinity for unlimited. */
  watchlistLimit: number;
  /** AI analyses per day. Keeps a paid account from becoming a loss leader. */
  aiRequestsPerDay: number;
}

export const FREE_ENTITLEMENTS: Entitlements = {
  tier: "free",
  aiSignals: false,
  aiScreenerRank: false,
  dipRadar: false,
  dividendAlerts: false,
  portfolioInsights: false,
  pushNotifications: false,
  screenshotImport: false,
  autoTradeBot: false,
  watchlistLimit: 5,
  aiRequestsPerDay: 3,
};

export const PRO_ENTITLEMENTS: Entitlements = {
  tier: "pro",
  aiSignals: true,
  aiScreenerRank: true,
  dipRadar: true,
  dividendAlerts: true,
  portfolioInsights: true,
  pushNotifications: true,
  screenshotImport: true,
  autoTradeBot: true,
  watchlistLimit: Infinity,
  // Generous but finite. Every AI call costs real money, so an unbounded
  // promise is one scripted user away from being unprofitable.
  aiRequestsPerDay: 200,
};

export interface Plan {
  id: PlanId;
  tier: Tier;
  name: string;
  /** Price in integer centavos. */
  priceCentavos: number;
  /** Days of access one purchase grants. */
  days: number;
  /** Shown on the pricing page. */
  blurb: string;
  purchasable: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    tier: "free",
    name: "Free",
    priceCentavos: 0,
    days: 0,
    blurb: "Prices, screener, paper trading and the leaderboard.",
    purchasable: false,
  },
  pro_monthly: {
    id: "pro_monthly",
    tier: "pro",
    name: "Pro — 30 days",
    priceCentavos: 29_900, // ₱299
    days: 30,
    blurb: "Everything, for a month. Renew whenever you like.",
    purchasable: true,
  },
  pro_annual: {
    id: "pro_annual",
    tier: "pro",
    name: "Pro — 1 year",
    priceCentavos: 299_000, // ₱2,990 — two months free against monthly
    days: 365,
    blurb: "Everything, for a year. Two months cheaper than renewing monthly.",
    purchasable: true,
  },
};

export const PURCHASABLE_PLANS: Plan[] = Object.values(PLANS).filter((p) => p.purchasable);

/**
 * Look up a plan by id.
 *
 * `Object.hasOwn` rather than a bare index, because the id arrives in a request
 * body: plain property access walks the prototype chain, so `planById("__proto__")`
 * returns `Object.prototype` — a truthy value that is not a plan, handed to code
 * that is about to read `.purchasable` and `.priceCentavos` off it.
 */
export function planById(id: string): Plan | null {
  return Object.hasOwn(PLANS, id) ? (PLANS as Record<string, Plan>)[id] : null;
}

export function entitlementsForTier(tier: Tier): Entitlements {
  return tier === "pro" ? PRO_ENTITLEMENTS : FREE_ENTITLEMENTS;
}

/** ₱ for display. Centavos in, formatted peso string out. */
export function formatPhp(centavos: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: centavos % 100 === 0 ? 0 : 2,
  }).format(centavos / 100);
}
