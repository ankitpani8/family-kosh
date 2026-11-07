// Import mapping test against an in-memory fake of the Supabase client. Data is synthetic.
import { beforeEach, describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const { db, rpcs, fake, reset } = vi.hoisted(() => {
const db: Record<string, Row[]> = {};
const rpcs: { fn: string; args: Row }[] = [];
let seq = 0;
  const reset = () => { seq = 0; };

function table(name: string) {
  const rows = (db[name] ??= []);
  let pending: Row[] | null = null;
  let mode: "insert" | "update" | "delete" | "upsert" | null = null;
  let patch: Row = {};
  const filters: [string, any][] = [];
  const apply = () => {
    if (mode === "insert" || mode === "upsert") {
      pending = pending!.map((r) => ({ id: r.id ?? `${name}-${++seq}`, ...r }));
      rows.push(...pending);
    } else if (mode === "update") {
      for (const r of rows) if (filters.every(([k, v]) => r[k] === v)) Object.assign(r, patch);
    } else if (mode === "delete") {
      for (let i = rows.length - 1; i >= 0; i--) if (filters.every(([k, v]) => rows[i][k] === v)) rows.splice(i, 1);
    }
  };
  const q: any = {
    insert(r: Row | Row[]) { mode = "insert"; pending = Array.isArray(r) ? r : [r]; return q; },
    upsert(r: Row | Row[]) { mode = "upsert"; pending = Array.isArray(r) ? r : [r]; return q; },
    update(p: Row) { mode = "update"; patch = p; return q; },
    delete() { mode = "delete"; return q; },
    eq(k: string, v: any) { filters.push([k, v]); return q; },
    in() { return q; },
    select() { return q; },
    single() { apply(); mode = null; return Promise.resolve({ data: pending![0], error: null }); },
    then(res: any, rej: any) { apply(); return Promise.resolve({ data: pending, error: null }).then(res, rej); },
  };
  return q;
}
const fake = {
  from: (n: string) => table(n),
  rpc: (fn: string, args: Row) => { rpcs.push({ fn, args }); return Promise.resolve({ error: null }); },
};
  return { db, rpcs, fake, reset };
});
vi.mock("../lib/supabase", () => ({ sb: () => fake, supabase: fake, isConfigured: true, appUrl: () => "" }));

import { guessMe, importKosh, parseExport } from "./importKosh";

const sample = {
  members: {
    me: { name: "Asha", relation: "Me", risk: "growth", income: 100000, expenses: 40000, order: 0 },
    mum: { name: "Mum", relation: "Mother", risk: "conservative", income: 0, expenses: 0, order: 1 },
  },
  prices: { gold: { label: "Gold", unit: "gram", price: 13000, history: [{ d: "2026-10-30", p: 13000 }] } },
  holdings: {
    bank: { name: "Bank", cls: "cash", owners: ["me"], mode: "value", value: 5000, history: [{ d: "2026-10-30", v: 4000 }, { d: "2026-11-07", v: 5000 }] },
    fd: { name: "Mum FD", cls: "fd", owners: ["mum"], mode: "value", value: 0, sip: 100000, paidBy: "me", estimate: true, history: [{ d: "2026-11-07", v: 0 }] },
    jewel: { name: "Gold", cls: "gold", owners: ["me", "mum"], mode: "units", units: 10, priceKey: "gold", history: [{ d: "2026-11-07", u: 10 }] },
    orphan: { name: "Nobody's", cls: "cash", owners: ["ghost"], value: 1 },
  },
  goals: { g: { name: "House", owner: "me", target: 900000, date: "2027-06", linked: ["fd", "missing"] } },
};

beforeEach(() => { for (const k of Object.keys(db)) delete db[k]; rpcs.length = 0; reset(); });

describe("import", () => {
  it("parses and finds 'me'", () => {
    const x = parseExport(JSON.stringify(sample));
    expect(guessMe(x)).toBe("me");
    expect(() => parseExport("{}")).toThrow(/members/);
  });

  it("maps people, holdings, prices, goals and a family", async () => {
    db.people = [{ id: "self", user_id: "u1", name: "Starter" }];
    const r = await importKosh(parseExport(JSON.stringify(sample)), { userId: "u1", selfId: "self", meKey: "me", familyName: "Fam" }, () => {});
    expect(r).toEqual({ people: 2, holdings: 3, goals: 1 });
    // "me" updates the existing self person; others become managed people.
    expect(db.people.find((p) => p.id === "self")!.name).toBe("Asha");
    const mum = db.people.find((p) => p.name === "Mum")!;
    expect(mum.manager_id).toBe("u1");
    // paid_by is remapped to the self person; units holdings point at the new series.
    const fd = db.holdings.find((h) => h.name === "Mum FD")!;
    expect(fd.paid_by).toBe("self");
    expect(fd.estimate).toBe(true);
    const jewel = db.holdings.find((h) => h.name === "Gold")!;
    expect(jewel.price_series_id).toBe(db.price_series[0].id);
    expect(db.holding_owners.filter((o) => o.holding_id === jewel.id).map((o) => o.person_id).sort()).toEqual([mum.id, "self"].sort());
    // History goes through the snapshot and price RPCs.
    expect(rpcs.filter((x) => x.fn === "record_snapshot")).toHaveLength(4);
    expect(rpcs.filter((x) => x.fn === "record_price")).toHaveLength(1);
    // Goal links skip holdings that weren't imported; target month becomes a date.
    expect(db.goals[0].target_month).toBe("2027-06-01");
    expect(db.goal_links).toEqual([{ id: expect.any(String), goal_id: db.goals[0].id, holding_id: fd.id }]);
    // Family gets the managed people (the creator is added by a database trigger).
    expect(db.families[0].name).toBe("Fam");
    expect(db.family_members.map((m) => m.person_id)).toEqual([mum.id]);
  });
});
