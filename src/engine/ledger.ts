// Valuation and aggregation: what everything is worth, for whom, and over time.
import { CLASSES, LT } from "./constants";
import { lastDayOfMonth, addDays } from "./dates";
import type { Bucket, Holding, Ledger, Liquidity, PriceSeries, Scope } from "./types";

export function priceOf(ledger: Ledger, id: string | null): PriceSeries | undefined {
  return id ? ledger.prices.find((p) => p.id === id) : undefined;
}

export function priceAt(series: PriceSeries | undefined, date?: string): number | null {
  if (!series) return null;
  if (!date) return series.price ?? null;
  const pts = series.history.filter((x) => x.d <= date && x.p != null);
  if (pts.length) return pts[pts.length - 1].p;
  return series.history[0]?.p ?? series.price ?? null;
}

/** Value of the whole holding (all owners) today, or on `date` from its history. null = unknown. */
export function valueOf(ledger: Ledger, h: Holding, date?: string): number | null {
  let v: number | null;
  if (h.mode === "units") {
    let u: number | null;
    if (!date) u = h.units;
    else {
      const pts = h.history.filter((x) => x.d <= date && x.u != null);
      if (!pts.length) return 0;
      u = pts[pts.length - 1].u ?? null;
    }
    if (u == null) return null;
    const p = priceAt(priceOf(ledger, h.priceSeriesId), date);
    if (p == null) return null;
    v = u * p;
  } else {
    if (!date) v = h.value;
    else {
      const pts = h.history.filter((x) => x.d <= date && x.v != null);
      v = pts.length ? (pts[pts.length - 1].v ?? 0) : 0;
    }
    if (v == null) return null;
  }
  return h.cls === "liability" ? -Math.abs(v) : v;
}

/** Fraction of a holding that belongs to the people in `scope`. */
export function factor(h: Holding, scope: Scope): number {
  const total = h.owners.reduce((s, o) => s + (o.share > 0 ? o.share : 0), 0);
  if (!h.owners.length) return 0;
  let mine = 0;
  for (const o of h.owners) if (scope.has(o.personId)) mine += total > 0 ? Math.max(0, o.share) / total : 1 / h.owners.length;
  return mine;
}

export function bucketOf(h: Holding): Bucket {
  return (CLASSES[h.cls] ?? CLASSES.other).bucket;
}

export function liqOf(h: Holding): Liquidity {
  return h.liq ?? (CLASSES[h.cls] ?? CLASSES.other).liq;
}

export function rateOf(h: Holding): number {
  return h.rate ?? (CLASSES[h.cls] ?? CLASSES.other).rate;
}

export function lastUpdated(h: Holding): string | null {
  return h.history.length ? h.history[h.history.length - 1].d : null;
}

export interface Aggregate {
  nw: number;
  investable: number;
  illiquid: number;
  owed: number;
  excluded: number;
  bucket: Partial<Record<Bucket, number>>;
  place: Record<string, number>;
  liq: Partial<Record<Liquidity, number>>;
  missing: Holding[];
  count: number;
}

export function aggregate(ledger: Ledger, scope: Scope): Aggregate {
  const r: Aggregate = { nw: 0, investable: 0, illiquid: 0, owed: 0, excluded: 0, bucket: {}, place: {}, liq: {}, missing: [], count: 0 };
  for (const h of ledger.holdings) {
    const f = factor(h, scope);
    if (!f) continue;
    const v = valueOf(ledger, h);
    if (v == null) {
      r.missing.push(h);
      continue;
    }
    const val = v * f;
    r.count++;
    if (!h.includeInNW) {
      r.excluded += val;
      continue;
    }
    const b = bucketOf(h);
    r.nw += val;
    if (b === "liability") {
      r.owed += -val;
      continue;
    }
    if (b === "property") r.illiquid += val;
    else r.investable += val;
    r.bucket[b] = (r.bucket[b] ?? 0) + val;
    const p = h.place || "Unspecified";
    r.place[p] = (r.place[p] ?? 0) + val;
    const l = liqOf(h);
    r.liq[l] = (r.liq[l] ?? 0) + val;
  }
  return r;
}

export function netWorthAt(ledger: Ledger, scope: Scope, date: string): number {
  let t = 0;
  for (const h of ledger.holdings) {
    if (!h.includeInNW) continue;
    const f = factor(h, scope);
    if (!f) continue;
    const v = valueOf(ledger, h, date);
    if (v) t += v * f;
  }
  return t;
}

/** Month-end net worth from the first recorded point to today (at most 10 years). */
export function timeline(ledger: Ledger, scope: Scope): { d: string; v: number }[] {
  const ds: string[] = [];
  for (const h of ledger.holdings) if (factor(h, scope)) for (const x of h.history) ds.push(x.d);
  for (const p of ledger.prices) for (const x of p.history) ds.push(x.d);
  if (!ds.length) return [];
  ds.sort();
  const start = ds[0];
  // The first recorded date is a point of its own, so a young ledger still shows a trend.
  const pts: string[] = start < ledger.today ? [start] : [];
  let [y, m] = start.split("-").map(Number);
  for (let i = 0; i < 400; i++) {
    const end = lastDayOfMonth(y, m);
    if (end >= ledger.today) break;
    if (end > start) pts.push(end);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  pts.push(ledger.today);
  return pts.slice(-121).map((d) => ({ d, v: netWorthAt(ledger, scope, d) }));
}

/** Change in net worth over roughly the last month. */
export function monthDelta(ledger: Ledger, scope: Scope): { abs: number; since: string } | null {
  const tl = timeline(ledger, scope);
  if (tl.length < 2) return null;
  const cut = addDays(ledger.today, -28);
  const prev = [...tl].reverse().find((p) => p.d <= cut);
  if (!prev) return null;
  return { abs: tl[tl.length - 1].v - prev.v, since: prev.d };
}

/** Current long-term mix (shares of equity/debt/gold/cash/intl) for a scope, or null if empty. */
export function currentMix(ledger: Ledger, scope: Scope) {
  const a = aggregate(ledger, scope);
  const s = LT.reduce((t, b) => t + Math.max(0, a.bucket[b] ?? 0), 0);
  if (!s) return null;
  return Object.fromEntries(LT.map((b) => [b, Math.max(0, a.bucket[b] ?? 0) / s])) as Record<(typeof LT)[number], number>;
}
