// Import a Family Kosh export (the JSON the earlier claude.ai artifact stored) into this account.
// The person marked as "me" becomes the signed-in account's self; everyone else becomes a person you manage.
import { sb } from "../lib/supabase";
import { addMember, createFamily, recordPrice, recordSnapshot, saveGoal, savePerson } from "./api";

type Doc = Record<string, any>;
export interface KoshExport {
  members: Record<string, Doc>;
  holdings: Record<string, Doc>;
  prices: Record<string, Doc>;
  goals: Record<string, Doc>;
  config?: Doc;
}

export function parseExport(text: string): KoshExport {
  const j = JSON.parse(text);
  for (const k of ["members", "holdings", "prices", "goals"]) if (!j[k] || typeof j[k] !== "object") throw new Error(`The file has no "${k}" section.`);
  return j as KoshExport;
}

export function guessMe(x: KoshExport): string | null {
  const e = Object.entries(x.members);
  return (e.find(([, m]) => String(m.relation).toLowerCase() === "me") ?? e[0])?.[0] ?? null;
}

export async function importKosh(
  x: KoshExport,
  opts: { userId: string; selfId: string; meKey: string; familyName: string | null },
  progress: (msg: string) => void,
): Promise<{ people: number; holdings: number; goals: number }> {
  const c = sb();
  const personId: Record<string, string> = {};

  progress("Adding people…");
  for (const [key, m] of Object.entries(x.members).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))) {
    const body = {
      name: String(m.name ?? key), relation: key === opts.meKey ? "Me" : String(m.relation ?? ""), color: m.color ?? "#3B5BDB",
      risk: ["conservative", "balanced", "growth"].includes(m.risk) ? m.risk : "balanced",
      income: Number(m.income) || 0, expenses: m.expenses == null ? null : Number(m.expenses), notes: String(m.notes ?? ""),
    };
    personId[key] = await savePerson(opts.userId, body, key === opts.meKey ? opts.selfId : undefined);
  }

  progress("Adding unit prices…");
  const seriesId: Record<string, string> = {};
  for (const [key, p] of Object.entries(x.prices)) {
    const { data, error } = await c.from("price_series").insert({ label: p.label, unit: p.unit, price: p.price ?? null, note: p.note ?? "" }).select("id").single();
    if (error) throw new Error(error.message);
    seriesId[key] = data.id;
    for (const pt of p.history ?? []) if (pt.p != null) await recordPrice(data.id, pt.d, Number(pt.p));
  }

  const holdingId: Record<string, string> = {};
  const entries = Object.entries(x.holdings);
  let i = 0;
  for (const [key, h] of entries) {
    progress(`Adding holdings (${++i} of ${entries.length})…`);
    const owners = (h.owners ?? []).map((o: string) => personId[o]).filter(Boolean);
    if (!owners.length) continue;
    const { data, error } = await c.from("holdings").insert({
      name: h.name, cls: h.cls ?? "other", place: h.place ?? "", mode: h.mode === "units" ? "units" : "value",
      value: h.value ?? null, units: h.units ?? null, price_series_id: h.priceKey ? (seriesId[h.priceKey] ?? null) : null,
      rate: h.rate ?? null, liq: h.liq ?? null, payout: !!h.payout, sip: h.sip ?? null,
      sip_source: h.sipSource === "payroll" ? "payroll" : "cash", paid_by: h.paidBy ? (personId[h.paidBy] ?? null) : null,
      include_in_nw: h.includeInNW !== false, estimate: !!h.estimate, private: false, notes: h.notes ?? "",
    }).select("id").single();
    if (error) throw new Error(`${h.name}: ${error.message}`);
    holdingId[key] = data.id;
    const { error: oe } = await c.from("holding_owners").insert(owners.map((pid: string) => ({ holding_id: data.id, person_id: pid, share: 1 })));
    if (oe) throw new Error(`${h.name}: ${oe.message}`);
    for (const pt of h.history ?? []) {
      const v = pt.v ?? null;
      const u = pt.u ?? null;
      if (v != null || u != null) await recordSnapshot(data.id, pt.d, v, u);
    }
    // record_snapshot clears the estimate flag; put it back if the export had it.
    if (h.estimate) await c.from("holdings").update({ estimate: true }).eq("id", data.id);
  }

  progress("Adding goals…");
  let goals = 0;
  for (const g of Object.values(x.goals)) {
    const owner = personId[g.owner];
    if (!owner) continue;
    await saveGoal({ personId: owner, name: g.name, target: Number(g.target) || 0, date: String(g.date).slice(0, 7), notes: g.notes ?? "",
      linked: (g.linked ?? []).map((k: string) => holdingId[k]).filter(Boolean) });
    goals++;
  }

  if (opts.familyName) {
    progress("Creating the family…");
    const fid = await createFamily(opts.familyName);
    for (const [key, pid] of Object.entries(personId)) if (key !== opts.meKey) await addMember(fid, pid);
  }
  if (x.config) await c.from("profiles").update({ settings: x.config }).eq("id", opts.userId);
  return { people: Object.keys(personId).length, holdings: Object.keys(holdingId).length, goals };
}
