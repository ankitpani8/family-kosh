// Cash flow, goals, targets and the rules engine that decides where next month's money goes.
// The rules engine is deliberately simple and deterministic. Signal tilts (settings.views or the
// `signals` table) are the hook for InvestBot: they shift target weights without changing this code.
import { HINT, LT } from "./constants";
import { monthsUntil } from "./dates";
import { aggregate, bucketOf, factor, liqOf, rateOf, valueOf } from "./ledger";
import type { Goal, Holding, Ledger, LongTermBucket, Mix, Person, Scope } from "./types";

const one = (id: string): Scope => new Set([id]);

export interface GoalStatus {
  goal: Goal;
  saved: number;
  /** Monthly contributions already flowing into linked holdings. */
  contrib: number;
  months: number;
  left: number;
  /** What's still missing after counting future contributions. */
  gap: number;
  monthly: number;
  overdue: boolean;
  onTrack: boolean;
  pct: number;
}

export function goalStatus(ledger: Ledger, g: Goal): GoalStatus {
  let saved = 0;
  let contrib = 0;
  for (const id of g.linked) {
    const h = ledger.holdings.find((x) => x.id === id);
    if (!h) continue;
    // A linked holding in someone else's name counts in full: linking is an explicit earmark.
    const f = h.owners.some((o) => o.personId === g.personId) ? factor(h, one(g.personId)) : 1;
    const v = valueOf(ledger, h);
    if (v != null) saved += v * f;
    if (h.sip) contrib += h.sip * (h.paidBy ? 1 : f);
  }
  const months = monthsUntil(g.date, ledger.today);
  const left = Math.max(0, (g.target || 0) - saved);
  const gap = Math.max(0, left - contrib * Math.max(0, months));
  return {
    goal: g, saved, contrib, months, left, gap,
    monthly: months > 0 ? gap / months : gap,
    overdue: months <= 0,
    onTrack: gap <= 0,
    pct: g.target ? Math.min(1, saved / g.target) : 0,
  };
}

export interface Contribution {
  holding: Holding;
  amount: number;
  source: "cash" | "payroll";
  /** The money goes into an account owned by someone else. */
  toOther: boolean;
}

export interface CashFlow {
  income: number;
  expenses: number | null;
  payouts: number;
  accrual: number;
  sipCash: number;
  sipPayroll: number;
  contributions: Contribution[];
  surplus: number | null;
  goals: GoalStatus[];
  goalNeed: number;
  unknownSpend: string[];
}

/** Next month's cash flow for one person. */
export function cashflow(ledger: Ledger, personId: string): CashFlow {
  const p = ledger.people.find((x) => x.id === personId);
  const out: CashFlow = {
    income: p?.income ?? 0, expenses: p?.expenses ?? null, payouts: 0, accrual: 0, sipCash: 0, sipPayroll: 0,
    contributions: [], surplus: null, goals: [], goalNeed: 0, unknownSpend: p && p.expenses == null ? [p.name] : [],
  };
  const me = one(personId);
  for (const h of ledger.holdings) {
    const f = factor(h, me);
    if (h.sip) {
      // Contributions are charged to whoever pays them; growth goes to whoever owns.
      const pf = h.paidBy ? (h.paidBy === personId ? 1 : 0) : f;
      if (pf) {
        const amount = h.sip * pf;
        if (h.sipSource === "payroll") out.sipPayroll += amount;
        else out.sipCash += amount;
        out.contributions.push({ holding: h, amount, source: h.sipSource, toOther: !!h.paidBy && !h.owners.some((o) => o.personId === personId) });
      }
    }
    if (!f) continue;
    const v = valueOf(ledger, h);
    if (v == null || bucketOf(h) === "liability" || !h.includeInNW) continue;
    const r = rateOf(h) / 100 / 12;
    if (h.payout) out.payouts += v * f * r;
    else out.accrual += v * f * r;
  }
  out.surplus = p?.expenses == null ? null : out.income + out.payouts - (out.expenses ?? 0) - out.sipCash;
  out.goals = ledger.goals.filter((g) => g.personId === personId).map((g) => goalStatus(ledger, g));
  out.goalNeed = out.goals.reduce((s, g) => s + (g.overdue ? g.gap : g.monthly), 0);
  return out;
}

/** Sum of cash flows across a scope. Surplus excludes people whose spending is unknown. */
export function scopeCashflow(ledger: Ledger, scope: Scope): CashFlow {
  const t: CashFlow = { income: 0, expenses: 0, payouts: 0, accrual: 0, sipCash: 0, sipPayroll: 0, contributions: [], surplus: 0, goals: [], goalNeed: 0, unknownSpend: [] };
  for (const p of ledger.people) {
    if (!scope.has(p.id)) continue;
    const c = cashflow(ledger, p.id);
    t.income += c.income;
    t.payouts += c.payouts;
    t.accrual += c.accrual;
    t.sipCash += c.sipCash;
    t.sipPayroll += c.sipPayroll;
    t.goalNeed += c.goalNeed;
    t.goals.push(...c.goals);
    t.contributions.push(...c.contributions);
    if (c.surplus == null) t.unknownSpend.push(p.name);
    else {
      t.expenses = (t.expenses ?? 0) + (c.expenses ?? 0);
      t.surplus = (t.surplus ?? 0) + c.surplus;
    }
  }
  return t;
}

const normalise = (o: Partial<Mix>): Mix => {
  const s = LT.reduce((t, b) => t + Math.max(0, Number(o[b]) || 0), 0);
  return Object.fromEntries(LT.map((b) => [b, s ? Math.max(0, Number(o[b]) || 0) / s : 0.2])) as Mix;
};

/** Target long-term weights for a scope: each person's risk profile, weighted by what they hold, then tilted. */
export function targetWeights(ledger: Ledger, scope: Scope): Mix {
  const cfg = ledger.settings;
  const people = ledger.people.filter((p) => scope.has(p.id));
  const base: Partial<Mix> = {};
  let tot = 0;
  for (const p of people) {
    const w = Math.max(1, aggregate(ledger, one(p.id)).investable);
    const t = cfg.targets[p.risk] ?? cfg.targets.balanced;
    for (const b of LT) base[b] = (base[b] ?? 0) + (t[b] ?? 0) * w;
    tot += w;
  }
  if (!tot) Object.assign(base, cfg.targets.balanced);
  const tilted: Partial<Mix> = {};
  for (const b of LT) tilted[b] = Math.max(0, (tot ? (base[b] ?? 0) / tot : (base[b] ?? 0)) + (Number(cfg.views[b]) || 0));
  return normalise(tilted);
}

export function mixFromPercent(m: Partial<Mix>): Mix {
  return normalise(m);
}

export interface Step {
  kind: string;
  bucket: LongTermBucket;
  amount: number;
  hint: string;
  why: string;
}

export interface Recommendation {
  person: Person | undefined;
  cf: CashFlow;
  blocked: boolean;
  steps: Step[];
  notes: { level: "good" | "warn" | "bad"; text: string }[];
  weights: Mix;
  current: Mix;
  after: Mix;
  longTermTotal: number;
  available: number;
  emergency: { need: number; liquid: number };
}

function roundAlloc(obj: Partial<Mix>, unit: number): Partial<Mix> {
  const keys = (Object.keys(obj) as LongTermBucket[]).filter((k) => (obj[k] ?? 0) > 0);
  const total = keys.reduce((s, k) => s + (obj[k] ?? 0), 0);
  const out: Partial<Mix> = {};
  const big = [...keys].sort((a, b) => (obj[b] ?? 0) - (obj[a] ?? 0))[0];
  let acc = 0;
  for (const k of keys) {
    if (k === big) continue;
    out[k] = Math.round((obj[k] ?? 0) / unit) * unit;
    acc += out[k]!;
  }
  if (big) out[big] = Math.max(0, Math.round(total) - acc);
  return out;
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const short = (n: number) => (n >= 1e5 ? `₹${(n / 1e5).toFixed(n >= 1e6 ? 1 : 2)} L` : inr(n));
const monthName = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] + " " + y;
};

/**
 * Where one person's free cash should go next month.
 * Order: emergency fund, then goals under 7 years, then whichever asset type is furthest below target.
 */
export function recommend(ledger: Ledger, personId: string): Recommendation {
  const cfg = ledger.settings;
  const cf = cashflow(ledger, personId);
  const me = one(personId);
  const zero = Object.fromEntries(LT.map((b) => [b, 0])) as Mix;
  const res: Recommendation = {
    person: ledger.people.find((p) => p.id === personId), cf, blocked: false, steps: [], notes: [],
    weights: targetWeights(ledger, me), current: { ...zero }, after: { ...zero }, longTermTotal: 0, available: 0,
    emergency: { need: 0, liquid: 0 },
  };
  if (cf.surplus == null) {
    res.blocked = true;
    return res;
  }
  let avail = Math.max(0, cf.surplus);
  res.available = avail;
  if (cf.surplus <= 0) res.notes.push({ level: "bad", text: `Spending and commitments exceed income by ${inr(-cf.surplus)} a month. Nothing is free to invest.` });

  const linked = new Set(ledger.goals.flatMap((g) => g.linked));
  const need = (cfg.emergencyMonths || 0) * (cf.expenses ?? 0);
  let liquid = 0;
  for (const h of ledger.holdings) {
    const f = factor(h, me);
    if (!f || linked.has(h.id) || !h.includeInNW) continue;
    const b = bucketOf(h);
    const l = liqOf(h);
    if ((b === "cash" || b === "debt") && (l === "instant" || l === "week")) {
      const v = valueOf(ledger, h);
      if (v) liquid += v * f;
    }
  }
  res.emergency = { need, liquid };
  if (need > liquid && avail > 0) {
    const put = Math.round(Math.min(need - liquid, avail * 0.5) / 500) * 500;
    if (put > 0) {
      res.steps.push({ kind: "Safety net", bucket: "cash", amount: put, hint: HINT.cash,
        why: `Emergency money is ${short(liquid)} of the ${short(need)} target (${cfg.emergencyMonths} months of spending). Half of free cash goes here until it's full.` });
      avail -= put;
    }
  }

  for (const gs of [...cf.goals].sort((a, b) => a.months - b.months)) {
    if (gs.gap <= 0 || gs.months > 84) continue;
    const want = gs.overdue ? gs.gap : gs.monthly;
    const amount = Math.max(0, Math.min(Math.ceil(want / 500) * 500, avail));
    const near = gs.months <= 36;
    if (amount >= 500)
      res.steps.push({
        kind: "Goal · " + gs.goal.name, bucket: near ? "debt" : "equity", amount,
        hint: near ? `Recurring deposit, or a debt fund you can redeem before ${monthName(gs.goal.date)}` : "Balanced advantage or aggressive hybrid fund",
        why: `${short(gs.gap)} short of ${short(gs.goal.target)} by ${monthName(gs.goal.date)} (${Math.max(gs.months, 0)} months)${gs.contrib ? `, after the ${short(gs.contrib)}/month already going in` : ""}. ${near ? "Under 3 years away, so it stays out of equity." : "3–7 years away, so a hybrid fund fits."}`,
      });
    if (amount + 1 < want)
      res.notes.push({ level: "warn", text: `${gs.goal.name} needs ${inr(want)}/month more${gs.contrib ? ` on top of the ${inr(gs.contrib)} already going in` : ""} to reach ${short(gs.goal.target)} by ${monthName(gs.goal.date)}, but only ${inr(amount)} is free. Link savings to it, free up cash, or move the date.` });
    avail -= amount;
  }

  const cur = { ...zero };
  for (const h of ledger.holdings) {
    const f = factor(h, me);
    if (!f || linked.has(h.id) || !h.includeInNW) continue;
    const b = bucketOf(h);
    if (!(LT as string[]).includes(b)) continue;
    const v = valueOf(ledger, h);
    if (v) cur[b as LongTermBucket] += v * f;
  }
  // The emergency reserve is not long-term money: take it out of cash first, then debt.
  let reserve = Math.min(need, liquid);
  const tc = Math.min(cur.cash, reserve);
  cur.cash -= tc;
  reserve -= tc;
  cur.debt = Math.max(0, cur.debt - reserve);
  res.current = { ...cur };

  const w = res.weights;
  const tot = LT.reduce((s, b) => s + cur[b], 0);
  const T = tot + avail;
  const deficit: Partial<Mix> = {};
  let ds = 0;
  for (const b of LT) {
    deficit[b] = Math.max(0, w[b] * T - cur[b]);
    ds += deficit[b]!;
  }
  const raw: Partial<Mix> = {};
  for (const b of LT) raw[b] = ds > 0 ? (avail * deficit[b]!) / ds : avail * w[b];
  const al = roundAlloc(raw, 500);
  for (const b of LT) {
    const a = al[b] ?? 0;
    if (a >= 500)
      res.steps.push({ kind: "Long-term", bucket: b, amount: a, hint: HINT[b],
        why: tot > 0 ? `${b[0].toUpperCase() + b.slice(1)} is ${Math.round((cur[b] / tot) * 100)}% of long-term money against a ${Math.round(w[b] * 100)}% target.` : `Starts the long-term mix at its ${Math.round(w[b] * 100)}% target.` });
  }
  for (const b of LT) res.after[b] = cur[b] + (al[b] ?? 0);
  res.longTermTotal = tot;
  return res;
}
