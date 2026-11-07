// Monte Carlo projection of a scope's long-term money under different strategies for new money.
// Existing holdings stay where they are; each strategy only decides where new money goes.
import { LT } from "./constants";
import { monthsUntil } from "./dates";
import { aggregate, bucketOf, currentMix, factor } from "./ledger";
import { mixFromPercent, scopeCashflow, targetWeights } from "./planning";
import type { Ledger, LongTermBucket, Mix, Scope } from "./types";

export type PathId = "current" | "target" | "safe" | "growth" | "custom";

export const PATHS: { id: PathId; name: string }[] = [
  { id: "current", name: "Keep current mix" },
  { id: "target", name: "Follow target" },
  { id: "safe", name: "Play safe" },
  { id: "growth", name: "Go for growth" },
  { id: "custom", name: "Custom mix" },
];

export interface SimOptions {
  years: number;
  monthly: number;
  stepUp: number;
  payGoals: boolean;
  real: boolean;
  target: number;
  paths: PathId[];
  custom: Partial<Mix>;
  runs?: number;
}

export interface PathResult {
  weights: Mix;
  p10: number[];
  p50: number[];
  p90: number[];
  /** Mean value per bucket per time step. */
  bucketMean: Record<LongTermBucket, number[]>;
  hitTarget: number;
  goalsPaid: number | null;
  final: { bucket: LongTermBucket; p10: number; p50: number; p90: number; mean: number; start: number }[];
}

export interface SimResult {
  months: number;
  step: number;
  points: number;
  years: number[];
  goals: { month: number; name: string; amount: number }[];
  paths: Partial<Record<PathId, PathResult>>;
}

export function simDefaults(ledger: Ledger, scope: Scope) {
  const cf = scopeCashflow(ledger, scope);
  return { monthly: Math.max(0, Math.round((cf.surplus ?? 0) / 1000) * 1000), stepUp: ledger.settings.incomeGrowth };
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pathWeights(ledger: Ledger, scope: Scope, id: PathId, custom: Partial<Mix>): Mix {
  if (id === "current") return currentMix(ledger, scope) ?? targetWeights(ledger, scope);
  if (id === "target") return targetWeights(ledger, scope);
  if (id === "safe") return mixFromPercent(ledger.settings.targets.conservative);
  if (id === "growth") return mixFromPercent(ledger.settings.targets.growth);
  return mixFromPercent(custom);
}

export function simulate(ledger: Ledger, scope: Scope, o: SimOptions): SimResult {
  const runs = o.runs ?? 240;
  const T = Math.max(1, Math.round(o.years * 12));
  const step = T > 60 ? 3 : 1;
  const np = Math.floor(T / step) + 1;
  const A = ledger.settings.assumptions;
  const infl = (ledger.settings.inflation || 0) / 100;
  const agg = aggregate(ledger, scope);
  const start = LT.map((b) => Math.max(0, agg.bucket[b] ?? 0));

  // Committed contributions keep flowing into their own asset types.
  const fixed = LT.map(() => 0);
  for (const h of ledger.holdings) {
    if (!h.sip) continue;
    const f = h.paidBy ? (scope.has(h.paidBy) && factor(h, scope) > 0 ? 1 : 0) : factor(h, scope);
    const i = LT.indexOf(bucketOf(h) as LongTermBucket);
    if (f && i >= 0) fixed[i] += h.sip * f;
  }
  const goals = ledger.goals
    .filter((g) => scope.has(g.personId))
    .map((g) => ({ month: Math.max(1, monthsUntil(g.date, ledger.today)), amount: g.target || 0, name: g.name }))
    .filter((g) => g.month <= T && g.amount > 0);

  const mu: number[] = [];
  const sg: number[] = [];
  LT.forEach((b, i) => {
    const x = A[b] ?? { ret: 0, vol: 0 };
    sg[i] = x.vol / 100 / Math.sqrt(12);
    mu[i] = Math.log(1 + x.ret / 100) / 12 - 0.5 * sg[i] * sg[i];
  });
  // Withdrawals for goals come from the safest money first: cash, debt, gold, intl, equity.
  const withdrawOrder = [3, 1, 2, 4, 0];
  const out: SimResult = { months: T, step, points: np, years: Array.from({ length: np }, (_, k) => (k * step) / 12), goals, paths: {} };

  for (const id of o.paths) {
    const w = pathWeights(ledger, scope, id, o.custom);
    const wv = LT.map((b) => w[b]);
    const tot = Array.from({ length: np }, () => new Float64Array(runs));
    const bmean = LT.map(() => new Float64Array(np));
    const fin = LT.map(() => new Float64Array(runs));
    let ok = 0;
    for (let r = 0; r < runs; r++) {
      const rng = mulberry32(97 + r * 7919);
      const v = start.slice();
      let fine = true;
      const rec = (k: number, m: number) => {
        const df = o.real ? Math.pow(1 + infl, m / 12) : 1;
        let s = 0;
        for (let i = 0; i < 5; i++) {
          s += v[i];
          bmean[i][k] += v[i] / df / runs;
        }
        tot[k][r] = s / df;
      };
      rec(0, 0);
      for (let m = 1; m <= T; m++) {
        const z0 = gauss(rng);
        // Equity and international share a market factor; the rest move independently.
        const z = [0.85 * z0 + 0.527 * gauss(rng), gauss(rng), gauss(rng), gauss(rng), 0.7 * z0 + 0.714 * gauss(rng)];
        const g = Math.pow(1 + o.stepUp / 100, Math.floor((m - 1) / 12));
        for (let i = 0; i < 5; i++) {
          v[i] *= Math.exp(mu[i] + sg[i] * z[i]);
          v[i] += o.monthly * g * wv[i] + fixed[i];
        }
        if (o.payGoals)
          for (const gl of goals) {
            if (gl.month !== m) continue;
            let need = gl.amount;
            for (const i of withdrawOrder) {
              const t = Math.min(v[i], need);
              v[i] -= t;
              need -= t;
              if (need <= 0) break;
            }
            if (need > 1) fine = false;
          }
        if (m % step === 0) rec(m / step, m);
      }
      if (fine) ok++;
      const df = o.real ? Math.pow(1 + infl, T / 12) : 1;
      for (let i = 0; i < 5; i++) fin[i][r] = v[i] / df;
    }
    const q = (arr: Float64Array, p: number) => {
      const s = Float64Array.from(arr).sort();
      return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
    };
    const p10: number[] = [];
    const p50: number[] = [];
    const p90: number[] = [];
    for (let k = 0; k < np; k++) {
      p10.push(q(tot[k], 0.1));
      p50.push(q(tot[k], 0.5));
      p90.push(q(tot[k], 0.9));
    }
    let hit = 0;
    for (let r = 0; r < runs; r++) if (tot[np - 1][r] >= o.target) hit++;
    out.paths[id] = {
      weights: w, p10, p50, p90,
      bucketMean: Object.fromEntries(LT.map((b, i) => [b, Array.from(bmean[i])])) as Record<LongTermBucket, number[]>,
      hitTarget: hit / runs,
      goalsPaid: goals.length && o.payGoals ? ok / runs : null,
      final: LT.map((b, i) => ({ bucket: b, p10: q(fin[i], 0.1), p50: q(fin[i], 0.5), p90: q(fin[i], 0.9), mean: bmean[i][np - 1], start: start[i] })),
    };
  }
  return out;
}
