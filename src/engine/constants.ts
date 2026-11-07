import type { Bucket, HoldingClass, Liquidity, LongTermBucket, Risk, Settings } from "./types";

export const CLASSES: Record<HoldingClass, { label: string; bucket: Bucket; rate: number; liq: Liquidity }> = {
  equity_stock: { label: "Stocks", bucket: "equity", rate: 12, liq: "instant" },
  equity_fund: { label: "Equity fund / ETF", bucket: "equity", rate: 12, liq: "instant" },
  debt_fund: { label: "Debt, liquid or arbitrage fund", bucket: "debt", rate: 7, liq: "instant" },
  fd: { label: "Fixed deposit / RD", bucket: "debt", rate: 7, liq: "week" },
  ppf: { label: "PPF / SSY", bucket: "debt", rate: 7.1, liq: "locked" },
  epf: { label: "EPF / NPS", bucket: "debt", rate: 8.25, liq: "locked" },
  insurance: { label: "Insurance policy (LIC, ULIP)", bucket: "debt", rate: 5, liq: "locked" },
  cash: { label: "Bank account / cash", bucket: "cash", rate: 3, liq: "instant" },
  gold: { label: "Gold (jewellery, coins, ETF)", bucket: "gold", rate: 9, liq: "week" },
  fx: { label: "Foreign currency", bucket: "intl", rate: 0, liq: "instant" },
  intl_equity: { label: "International equity", bucket: "intl", rate: 11, liq: "week" },
  property: { label: "Property / land", bucket: "property", rate: 6, liq: "illiquid" },
  crypto: { label: "Crypto", bucket: "alt", rate: 0, liq: "instant" },
  other: { label: "Other", bucket: "alt", rate: 0, liq: "week" },
  liability: { label: "Loan / money owed", bucket: "liability", rate: 9, liq: "instant" },
};

export const BUCKET_LABEL: Record<Bucket, string> = {
  equity: "Equity",
  debt: "Debt & fixed income",
  gold: "Gold",
  cash: "Cash",
  intl: "International",
  property: "Property",
  alt: "Other",
  liability: "Owed",
};

export const LT: LongTermBucket[] = ["equity", "debt", "gold", "cash", "intl"];

export const LIQ_LABEL: Record<Liquidity, string> = {
  instant: "Same day",
  week: "Within a week",
  locked: "Locked in",
  illiquid: "Hard to sell",
};

export const RISK_LABEL: Record<Risk, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  growth: "Growth",
};

export const HINT: Record<LongTermBucket, string> = {
  equity: "Nifty 50 or Nifty 500 index fund, as a Groww SIP",
  debt: "PPF up to its ₹1.5L/yr limit, then a short-duration debt fund",
  gold: "Gold ETF or gold fund rather than jewellery",
  cash: "Liquid fund or sweep-in FD",
  intl: "S&P 500 / Nasdaq-100 fund of funds",
};

export const DEFAULT_SETTINGS: Settings = {
  emergencyMonths: 6,
  inflation: 6,
  incomeGrowth: 7,
  targets: {
    conservative: { equity: 20, debt: 60, gold: 10, cash: 10, intl: 0 },
    balanced: { equity: 50, debt: 30, gold: 10, cash: 5, intl: 5 },
    growth: { equity: 65, debt: 15, gold: 7, cash: 3, intl: 10 },
  },
  assumptions: {
    equity: { ret: 12, vol: 18 },
    debt: { ret: 7, vol: 3 },
    gold: { ret: 9, vol: 15 },
    cash: { ret: 4, vol: 1 },
    intl: { ret: 11, vol: 20 },
  },
  views: { equity: 0, debt: 0, gold: 0, cash: 0, intl: 0 },
  signalSource: "Manual",
};

/** Deep-merge stored settings over defaults so older or partial records stay valid. */
export function mergeSettings(stored: Partial<Settings> | null | undefined): Settings {
  const s: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!stored) return s;
  for (const k of ["emergencyMonths", "inflation", "incomeGrowth", "signalSource"] as const) {
    if (stored[k] !== undefined && stored[k] !== null) (s as any)[k] = stored[k];
  }
  for (const r of Object.keys(s.targets) as Risk[]) Object.assign(s.targets[r], stored.targets?.[r] ?? {});
  for (const b of LT) Object.assign(s.assumptions[b], stored.assumptions?.[b] ?? {});
  Object.assign(s.views, stored.views ?? {});
  return s;
}

export const MEMBER_COLORS = ["#3B5BDB", "#9D174D", "#0F766E", "#C2410C", "#6D28D9", "#4D7C0F", "#0369A1", "#A16207"];
