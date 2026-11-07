// Domain types used by the engine. The data layer maps database rows into these.

export type Bucket = "equity" | "debt" | "gold" | "cash" | "intl" | "property" | "alt" | "liability";
export type LongTermBucket = "equity" | "debt" | "gold" | "cash" | "intl";
export type Risk = "conservative" | "balanced" | "growth";
export type Liquidity = "instant" | "week" | "locked" | "illiquid";
export type HoldingClass =
  | "equity_stock" | "equity_fund" | "debt_fund" | "fd" | "ppf" | "epf" | "insurance"
  | "cash" | "gold" | "fx" | "intl_equity" | "property" | "crypto" | "other" | "liability";

export interface Person {
  id: string;
  name: string;
  relation: string;
  color: string;
  risk: Risk;
  income: number;
  /** Monthly spending paid from this person's own money. null = unknown. */
  expenses: number | null;
  notes: string;
  /** true when this person is the signed-in account. */
  isMe?: boolean;
  /** true when the person has no login and is managed by the signed-in account. */
  managedByMe?: boolean;
  /** true when the person has their own login. */
  hasLogin?: boolean;
}

export interface Owner {
  personId: string;
  /** Relative share. Shares are normalised per holding, so [1,1] means 50/50. */
  share: number;
}

export interface HistoryPoint {
  d: string; // YYYY-MM-DD
  v?: number | null;
  u?: number | null;
}

export interface Holding {
  id: string;
  name: string;
  cls: HoldingClass;
  place: string;
  mode: "value" | "units";
  value: number | null;
  units: number | null;
  priceSeriesId: string | null;
  rate: number | null;
  liq: Liquidity | null;
  /** Interest is paid out monthly and counts as income. */
  payout: boolean;
  /** Committed monthly contribution. */
  sip: number | null;
  sipSource: "cash" | "payroll";
  /** Person whose cash pays the contribution, when it isn't the owners. */
  paidBy: string | null;
  includeInNW: boolean;
  estimate: boolean;
  /** Hidden from family members who don't own or manage it. */
  private: boolean;
  notes: string;
  owners: Owner[];
  history: HistoryPoint[];
}

export interface PriceSeries {
  id: string;
  label: string;
  unit: string;
  price: number | null;
  note: string;
  history: { d: string; p: number }[];
}

export interface Goal {
  id: string;
  personId: string;
  name: string;
  target: number;
  /** YYYY-MM */
  date: string;
  notes: string;
  linked: string[];
}

export type Mix = Record<LongTermBucket, number>;

export interface Settings {
  emergencyMonths: number;
  inflation: number;
  incomeGrowth: number;
  targets: Record<Risk, Mix>;
  assumptions: Record<LongTermBucket, { ret: number; vol: number }>;
  views: Mix;
  signalSource: string;
}

export interface Ledger {
  people: Person[];
  holdings: Holding[];
  prices: PriceSeries[];
  goals: Goal[];
  settings: Settings;
  /** YYYY-MM-DD, injected so the engine stays pure and testable. */
  today: string;
}

/** A scope is the set of people whose money is being looked at. */
export type Scope = ReadonlySet<string>;
