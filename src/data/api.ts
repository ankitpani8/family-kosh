// All reads and writes to Supabase. Row-level security decides what each call can see or change.
import { sb } from "../lib/supabase";
import type { Holding, Owner, Person, Settings } from "../engine";
import type { Remote } from "./model";

async function rows<T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function ok(q: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export async function loadRemote(userId: string): Promise<Remote> {
  const c = sb();
  const [profile, people, families, members, holdings, owners, snapshots, series, points, goals, links, signals] = await Promise.all([
    rows(c.from("profiles").select("id, display_name, settings").eq("id", userId)),
    rows(c.from("people").select("*")),
    rows(c.from("families").select("id, name, created_by")),
    rows(c.from("family_members").select("family_id, person_id, role")),
    rows(c.from("holdings").select("*")),
    rows(c.from("holding_owners").select("holding_id, person_id, share")),
    rows(c.from("holding_snapshots").select("holding_id, d, value, units").order("d")),
    rows(c.from("price_series").select("id, owner_id, label, unit, price, note")),
    rows(c.from("price_points").select("series_id, d, price").order("d")),
    rows(c.from("goals").select("id, person_id, name, target, target_month, notes")),
    rows(c.from("goal_links").select("goal_id, holding_id")),
    rows(c.from("signals").select("source, as_of, views").order("as_of", { ascending: false }).limit(1)),
  ]);
  return {
    userId, fetchedAt: new Date().toISOString(), profile: (profile[0] as any) ?? null,
    people: people as any, families: families as any, members: members as any, holdings: holdings as any,
    owners: owners as any, snapshots: snapshots as any, series: series as any, points: points as any,
    goals: goals as any, links: links as any, signal: (signals[0] as any) ?? null,
  };
}

// ── profile & settings ──
export const saveSettings = (userId: string, settings: Partial<Settings> & { useSignals?: boolean }) =>
  ok(sb().from("profiles").update({ settings }).eq("id", userId));
export const saveDisplayName = (userId: string, display_name: string) => ok(sb().from("profiles").update({ display_name }).eq("id", userId));

// ── people ──
type PersonInput = Pick<Person, "name" | "relation" | "color" | "risk" | "income" | "expenses" | "notes">;
export async function savePerson(userId: string, p: PersonInput, id?: string): Promise<string> {
  const body = { name: p.name, relation: p.relation, color: p.color, risk: p.risk, income: p.income, expenses: p.expenses, notes: p.notes };
  if (id) {
    await ok(sb().from("people").update(body).eq("id", id));
    return id;
  }
  const { data, error } = await sb().from("people").insert({ ...body, manager_id: userId }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}
export const deletePerson = (id: string) => ok(sb().from("people").delete().eq("id", id));

// ── families ──
export async function createFamily(name: string): Promise<string> {
  const { data, error } = await sb().from("families").insert({ name }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}
export const renameFamily = (id: string, name: string) => ok(sb().from("families").update({ name }).eq("id", id));
export const deleteFamily = (id: string) => ok(sb().from("families").delete().eq("id", id));
export const addMember = (familyId: string, personId: string) => ok(sb().from("family_members").insert({ family_id: familyId, person_id: personId }));
export const removeMember = (familyId: string, personId: string) =>
  ok(sb().from("family_members").delete().eq("family_id", familyId).eq("person_id", personId));
export const setRole = (familyId: string, personId: string, role: "admin" | "member") =>
  ok(sb().from("family_members").update({ role }).eq("family_id", familyId).eq("person_id", personId));
export async function createInvite(familyId: string): Promise<string> {
  const { data, error } = await sb().from("family_invites").insert({ family_id: familyId }).select("code").single();
  if (error) throw new Error(error.message);
  return data.code;
}
export async function joinFamily(code: string): Promise<void> {
  const { error } = await sb().rpc("join_family", { invite_code: code });
  if (error) throw new Error(error.message);
}
export async function createClaim(personId: string): Promise<string> {
  const { data, error } = await sb().from("person_claims").insert({ person_id: personId }).select("code").single();
  if (error) throw new Error(error.message);
  return data.code;
}
export async function claimPerson(code: string): Promise<void> {
  const { error } = await sb().rpc("claim_person", { claim_code: code });
  if (error) throw new Error(error.message);
}

// ── holdings ──
export type HoldingInput = Omit<Holding, "id" | "history" | "owners">;
function holdingBody(h: HoldingInput) {
  return {
    name: h.name, cls: h.cls, place: h.place, mode: h.mode, value: h.value, units: h.units, price_series_id: h.priceSeriesId,
    rate: h.rate, liq: h.liq, payout: h.payout, sip: h.sip, sip_source: h.sipSource, paid_by: h.paidBy,
    include_in_nw: h.includeInNW, estimate: h.estimate, private: h.private, notes: h.notes, updated_at: new Date().toISOString(),
  };
}

/** Create or update a holding and its owners. Records a history point when the value or units changed. */
export async function saveHolding(h: HoldingInput, owners: Owner[], today: string, prev?: Holding): Promise<string> {
  const c = sb();
  let id = prev?.id;
  if (id) await ok(c.from("holdings").update(holdingBody(h)).eq("id", id));
  else {
    const { data, error } = await c.from("holdings").insert(holdingBody(h)).select("id").single();
    if (error) throw new Error(error.message);
    id = data.id as string;
  }
  // Replace owners: add/update the new set, then remove anyone no longer listed.
  // Order matters: adding first keeps edit rights through the change.
  await ok(c.from("holding_owners").upsert(owners.map((o) => ({ holding_id: id, person_id: o.personId, share: o.share }))));
  const keep = owners.map((o) => o.personId);
  const stale = (prev?.owners ?? []).filter((o) => !keep.includes(o.personId)).map((o) => o.personId);
  if (stale.length) await ok(c.from("holding_owners").delete().eq("holding_id", id).in("person_id", stale));
  const changed = h.mode === "units" ? h.units != null && h.units !== prev?.units : h.value != null && h.value !== prev?.value;
  if (changed) await recordSnapshot(id!, today, h.mode === "value" ? h.value : null, h.mode === "units" ? h.units : null);
  return id!;
}
export async function recordSnapshot(holdingId: string, date: string, value: number | null, units: number | null) {
  const { error } = await sb().rpc("record_snapshot", { hid: holdingId, on_date: date, new_value: value, new_units: units });
  if (error) throw new Error(error.message);
}
export const deleteHolding = (id: string) => ok(sb().from("holdings").delete().eq("id", id));

// ── unit prices ──
export async function createSeries(label: string, unit: string, price: number | null, note: string, date: string): Promise<string> {
  const { data, error } = await sb().from("price_series").insert({ label, unit, price, note }).select("id").single();
  if (error) throw new Error(error.message);
  if (price != null) await recordPrice(data.id, date, price);
  return data.id;
}
export const updateSeries = (id: string, label: string, unit: string, note: string) =>
  ok(sb().from("price_series").update({ label, unit, note }).eq("id", id));
export async function recordPrice(seriesId: string, date: string, price: number) {
  const { error } = await sb().rpc("record_price", { sid: seriesId, on_date: date, new_price: price });
  if (error) throw new Error(error.message);
}
export const deleteSeries = (id: string) => ok(sb().from("price_series").delete().eq("id", id));

// ── goals ──
export async function saveGoal(g: { personId: string; name: string; target: number; date: string; notes: string; linked: string[] }, id?: string) {
  const c = sb();
  const body = { person_id: g.personId, name: g.name, target: g.target, target_month: g.date + "-01", notes: g.notes };
  if (id) await ok(c.from("goals").update(body).eq("id", id));
  else {
    const { data, error } = await c.from("goals").insert(body).select("id").single();
    if (error) throw new Error(error.message);
    id = data.id as string;
  }
  await ok(c.from("goal_links").delete().eq("goal_id", id));
  if (g.linked.length) await ok(c.from("goal_links").insert(g.linked.map((hid) => ({ goal_id: id, holding_id: hid }))));
  return id!;
}
export const deleteGoal = (id: string) => ok(sb().from("goals").delete().eq("id", id));

// ── Claude second opinion (optional Supabase Edge Function) ──
export async function secondOpinion(prompt: string): Promise<string> {
  const { data, error } = await sb().functions.invoke("second-opinion", { body: { prompt } });
  if (error) throw new Error(error.message);
  return String((data as { text?: string })?.text ?? "");
}
