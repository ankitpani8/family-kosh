// Engine tests. Fixture numbers are synthetic: real family data never goes into the repo.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, aggregate, cashflow, factor, goalStatus, monthDelta, monthsUntil, recommend, simulate,
  targetWeights, timeline, valueOf,
} from "./index";
import type { Holding, Ledger } from "./types";

const H = (p: Partial<Holding> & Pick<Holding, "id" | "name" | "cls" | "owners">): Holding => ({
  place: "", mode: "value", value: null, units: null, priceSeriesId: null, rate: null, liq: null, payout: false,
  sip: null, sipSource: "cash", paidBy: null, includeInNW: true, estimate: false, private: false, notes: "", history: [], ...p,
});

function fixture(): Ledger {
  return {
    today: "2026-11-07",
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    people: [
      { id: "a", name: "Asha", relation: "Me", color: "#000", risk: "growth", income: 200000, expenses: 50000, notes: "" },
      { id: "b", name: "Bina", relation: "Partner", color: "#111", risk: "balanced", income: 90000, expenses: null, notes: "" },
      { id: "m", name: "Mother", relation: "Mother", color: "#222", risk: "conservative", income: 0, expenses: 0, notes: "" },
    ],
    prices: [
      { id: "gold", label: "Gold 22K", unit: "gram", price: 13000, note: "", history: [{ d: "2026-10-01", p: 12000 }, { d: "2026-11-01", p: 13000 }] },
    ],
    holdings: [
      H({ id: "cash-a", name: "Bank", cls: "cash", owners: [{ personId: "a", share: 1 }], value: 300000, history: [{ d: "2026-10-01", v: 200000 }, { d: "2026-11-05", v: 300000 }] }),
      H({ id: "etf-a", name: "Index ETF", cls: "equity_fund", owners: [{ personId: "a", share: 1 }], value: 100000, sip: 20000 }),
      H({ id: "epf-a", name: "EPF", cls: "epf", owners: [{ personId: "a", share: 1 }], value: 500000, sip: 20000, sipSource: "payroll" }),
      H({ id: "gold-j", name: "Jewellery", cls: "gold", owners: [{ personId: "a", share: 1 }, { personId: "m", share: 1 }], mode: "units", units: 10, priceSeriesId: "gold", history: [{ d: "2026-10-01", u: 10 }] }),
      H({ id: "house-fd", name: "House FD", cls: "fd", owners: [{ personId: "m", share: 1 }], value: 0, sip: 100000, paidBy: "a" }),
      H({ id: "fd-m", name: "FD", cls: "fd", owners: [{ personId: "m", share: 1 }], value: 400000, rate: 7.2, payout: true }),
      H({ id: "land", name: "Land", cls: "property", owners: [{ personId: "m", share: 1 }], value: 5000000 }),
      H({ id: "shared", name: "Disputed land", cls: "property", owners: [{ personId: "m", share: 1 }], value: 9000000, includeInNW: false }),
      H({ id: "unknown", name: "Policy", cls: "insurance", owners: [{ personId: "b", share: 1 }], value: null }),
      H({ id: "loan", name: "Car loan", cls: "liability", owners: [{ personId: "b", share: 1 }], value: 50000 }),
    ],
    goals: [
      { id: "g-house", personId: "a", name: "House", target: 1500000, date: "2027-06", notes: "", linked: ["house-fd"] },
      { id: "g-trip", personId: "a", name: "Trip", target: 200000, date: "2027-11", notes: "", linked: [] },
    ],
  };
}
const S = (...ids: string[]) => new Set(ids);

describe("valuation", () => {
  it("values unit holdings at the latest price and at past dates", () => {
    const L = fixture();
    const g = L.holdings.find((h) => h.id === "gold-j")!;
    expect(valueOf(L, g)).toBe(130000);
    expect(valueOf(L, g, "2026-10-15")).toBe(120000);
    expect(valueOf(L, g, "2026-09-01")).toBe(0);
  });
  it("splits joint holdings by share", () => {
    const g = fixture().holdings.find((h) => h.id === "gold-j")!;
    expect(factor(g, S("a"))).toBe(0.5);
    expect(factor(g, S("a", "m"))).toBe(1);
    expect(factor({ ...g, owners: [{ personId: "a", share: 3 }, { personId: "m", share: 1 }] }, S("a"))).toBe(0.75);
  });
  it("treats liabilities as negative and skips excluded holdings", () => {
    const L = fixture();
    const fam = aggregate(L, S("a", "b", "m"));
    expect(fam.owed).toBe(50000);
    expect(fam.excluded).toBe(9000000);
    expect(fam.missing.map((h) => h.id)).toEqual(["unknown"]);
    expect(fam.nw).toBe(300000 + 100000 + 500000 + 130000 + 0 + 400000 + 5000000 - 50000);
    expect(fam.illiquid).toBe(5000000);
  });
  it("builds a month-end timeline that ends today", () => {
    const L = fixture();
    const tl = timeline(L, S("a"));
    expect(tl[tl.length - 1].d).toBe("2026-11-07");
    expect(tl.map((p) => p.d)).toEqual(["2026-10-01", "2026-10-31", "2026-11-07"]);
    expect(monthDelta(L, S("a"))).not.toBeNull();
  });
});

describe("cash flow and goals", () => {
  it("charges contributions to the payer, not the owner", () => {
    const L = fixture();
    const a = cashflow(L, "a");
    expect(a.sipCash).toBe(20000 + 100000);
    expect(a.sipPayroll).toBe(20000);
    expect(a.surplus).toBe(200000 - 50000 - 120000);
    expect(a.contributions.find((c) => c.holding.id === "house-fd")?.toOther).toBe(true);
    const m = cashflow(L, "m");
    expect(m.sipCash).toBe(0);
    expect(Math.round(m.payouts)).toBe(Math.round((400000 * 0.072) / 12));
  });
  it("leaves surplus unknown when spending is unknown", () => {
    expect(cashflow(fixture(), "b").surplus).toBeNull();
    expect(recommend(fixture(), "b").blocked).toBe(true);
  });
  it("counts future contributions into linked holdings against the goal", () => {
    const L = fixture();
    const g = goalStatus(L, L.goals[0]);
    expect(g.months).toBe(7);
    expect(g.contrib).toBe(100000);
    expect(g.gap).toBe(1500000 - 700000);
    expect(Math.round(g.monthly)).toBe(Math.round(800000 / 7));
    expect(monthsUntil("2027-06", "2026-11-30")).toBe(7);
  });
});

describe("rules engine", () => {
  it("never places more than the free cash", () => {
    const L = fixture();
    const r = recommend(L, "a");
    const placed = r.steps.reduce((s, x) => s + x.amount, 0);
    expect(placed).toBeLessThanOrEqual(r.available + 1);
    expect(r.steps[0].kind).toBe("Goal · House");
    expect(r.notes.some((n) => n.text.includes("House"))).toBe(true);
  });
  it("fills the emergency fund before long-term money", () => {
    const L = fixture();
    L.holdings = L.holdings.filter((h) => h.id !== "cash-a" && h.id !== "house-fd");
    L.goals = [];
    const r = recommend(L, "a");
    expect(r.steps[0].kind).toBe("Safety net");
    expect(r.steps[0].amount).toBe(65000); // half of the 1,30,000 free
  });
  it("applies signal tilts to target weights", () => {
    const L = fixture();
    const before = targetWeights(L, S("a")).equity;
    L.settings.views.equity = 10;
    expect(targetWeights(L, S("a")).equity).toBeGreaterThan(before);
    const w = targetWeights(L, S("a"));
    expect(Object.values(w).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
  });
});

describe("simulator", () => {
  it("is deterministic and orders percentiles", () => {
    const L = fixture();
    const o = { years: 10, monthly: 30000, stepUp: 5, payGoals: true, real: false, target: 5e6, paths: ["safe", "growth"] as const, custom: {}, runs: 80 };
    const a = simulate(L, S("a", "m"), { ...o, paths: [...o.paths] });
    const b = simulate(L, S("a", "m"), { ...o, paths: [...o.paths] });
    expect(a.paths.growth!.p50).toEqual(b.paths.growth!.p50);
    const g = a.paths.growth!;
    const last = a.points - 1;
    expect(g.p10[last]).toBeLessThanOrEqual(g.p50[last]);
    expect(g.p50[last]).toBeLessThanOrEqual(g.p90[last]);
    expect(a.goals.map((x) => x.name)).toEqual(["House", "Trip"]);
  });
  it("grows a deposit-only plan by roughly the debt return", () => {
    const L = fixture();
    L.holdings = [];
    L.goals = [];
    L.settings.assumptions.debt = { ret: 7, vol: 0 };
    const r = simulate(L, S("a"), { years: 1, monthly: 10000, stepUp: 0, payGoals: false, real: false, target: 0, paths: ["custom"], custom: { debt: 100 }, runs: 5 });
    const end = r.paths.custom!.p50[r.points - 1];
    expect(end).toBeGreaterThan(120000);
    expect(end).toBeLessThan(125000);
  });
  it("stops contributions into a goal-linked holding when the goal falls due", () => {
    const L = fixture();
    L.holdings = L.holdings.filter((h) => h.id === "house-fd");
    L.settings.assumptions.debt = { ret: 0, vol: 0 };
    const opts = { years: 2, monthly: 0, stepUp: 0, payGoals: false, real: false, target: 0, paths: ["safe" as const], custom: {}, runs: 3 };
    const r = simulate(L, S("a", "m"), opts);
    expect(Math.round(r.paths.safe!.p50[r.points - 1])).toBe(700000); // 7 months × 1L, then it stops
  });
});
