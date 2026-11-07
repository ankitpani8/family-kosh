// Database row shapes and the mapping from rows to the engine's Ledger.
import { mergeSettings, type Holding, type HoldingClass, type Ledger, type Liquidity, type Person, type Risk, type Settings } from "../engine";

export interface ProfileRow { id: string; display_name: string; settings: Partial<Settings> & { useSignals?: boolean } }
export interface PersonRow {
  id: string; user_id: string | null; manager_id: string | null; name: string; relation: string; color: string;
  risk: Risk; income: number; expenses: number | null; notes: string; sort: number;
}
export interface FamilyRow { id: string; name: string; created_by: string }
export interface MemberRow { family_id: string; person_id: string; role: "admin" | "member" }
export interface HoldingRow {
  id: string; created_by: string | null; name: string; cls: HoldingClass; place: string; mode: "value" | "units";
  value: number | null; units: number | null; price_series_id: string | null; rate: number | null; liq: Liquidity | null;
  payout: boolean; sip: number | null; sip_source: "cash" | "payroll"; paid_by: string | null; include_in_nw: boolean;
  estimate: boolean; private: boolean; notes: string; updated_at: string;
}
export interface OwnerRow { holding_id: string; person_id: string; share: number }
export interface SnapshotRow { holding_id: string; d: string; value: number | null; units: number | null }
export interface SeriesRow { id: string; owner_id: string; label: string; unit: string; price: number | null; note: string }
export interface PointRow { series_id: string; d: string; price: number }
export interface GoalRow { id: string; person_id: string; name: string; target: number; target_month: string; notes: string }
export interface LinkRow { goal_id: string; holding_id: string }
export interface SignalRow { source: string; as_of: string; views: Record<string, number> }

/** Everything the signed-in account can see, as fetched. Cached offline as-is. */
export interface Remote {
  userId: string;
  fetchedAt: string;
  profile: ProfileRow | null;
  people: PersonRow[];
  families: FamilyRow[];
  members: MemberRow[];
  holdings: HoldingRow[];
  owners: OwnerRow[];
  snapshots: SnapshotRow[];
  series: SeriesRow[];
  points: PointRow[];
  goals: GoalRow[];
  links: LinkRow[];
  signal: SignalRow | null;
}

const n = (v: unknown): number | null => (v == null ? null : Number(v));

export function toLedger(r: Remote, today: string): Ledger {
  const people: Person[] = [...r.people]
    .sort((a, b) => (a.user_id === r.userId ? -1 : b.user_id === r.userId ? 1 : a.sort - b.sort || a.name.localeCompare(b.name)))
    .map((p) => ({
      id: p.id, name: p.name, relation: p.relation, color: p.color, risk: p.risk,
      income: Number(p.income) || 0, expenses: n(p.expenses), notes: p.notes,
      isMe: p.user_id === r.userId, managedByMe: p.manager_id === r.userId && !p.user_id, hasLogin: !!p.user_id,
    }));
  const ownersBy = group(r.owners, (o) => o.holding_id);
  const snapsBy = group(r.snapshots, (s) => s.holding_id);
  const pointsBy = group(r.points, (p) => p.series_id);
  const linksBy = group(r.links, (l) => l.goal_id);
  const holdings: Holding[] = r.holdings.map((h) => ({
    id: h.id, name: h.name, cls: h.cls, place: h.place, mode: h.mode, value: n(h.value), units: n(h.units),
    priceSeriesId: h.price_series_id, rate: n(h.rate), liq: h.liq, payout: h.payout, sip: n(h.sip), sipSource: h.sip_source,
    paidBy: h.paid_by, includeInNW: h.include_in_nw, estimate: h.estimate, private: h.private, notes: h.notes,
    owners: (ownersBy[h.id] ?? []).map((o) => ({ personId: o.person_id, share: Number(o.share) || 1 })),
    history: (snapsBy[h.id] ?? []).map((s) => ({ d: s.d, v: n(s.value), u: n(s.units) })).sort((a, b) => a.d.localeCompare(b.d)),
  }));
  const settings = mergeSettings(r.profile?.settings);
  if (r.profile?.settings?.useSignals && r.signal) {
    settings.views = { ...settings.views, ...r.signal.views } as Settings["views"];
    settings.signalSource = `${r.signal.source} (${r.signal.as_of})`;
  }
  return {
    today,
    people,
    holdings,
    prices: r.series.map((s) => ({
      id: s.id, label: s.label, unit: s.unit, price: n(s.price), note: s.note,
      history: (pointsBy[s.id] ?? []).map((p) => ({ d: p.d, p: Number(p.price) })).sort((a, b) => a.d.localeCompare(b.d)),
    })),
    goals: r.goals.map((g) => ({
      id: g.id, personId: g.person_id, name: g.name, target: Number(g.target), date: g.target_month.slice(0, 7), notes: g.notes,
      linked: (linksBy[g.id] ?? []).map((l) => l.holding_id),
    })),
    settings,
  };
}

function group<T>(rows: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[key(r)] ??= []).push(r);
  return out;
}

/** People the signed-in account may edit: itself and people it manages. */
export function editablePeople(r: Remote): Set<string> {
  return new Set(r.people.filter((p) => p.user_id === r.userId || (p.manager_id === r.userId && !p.user_id)).map((p) => p.id));
}

export function canEditHolding(r: Remote, h: Holding): boolean {
  const mine = editablePeople(r);
  return h.owners.length === 0 || h.owners.some((o) => mine.has(o.personId));
}

export interface ScopeOption { id: string; label: string; people: string[]; kind: "me" | "family" | "person" | "all" }

/** The views the app offers: me, each family, everyone visible, and each person. */
export function scopeOptions(r: Remote, ledger: Ledger): ScopeOption[] {
  const me = ledger.people.find((p) => p.isMe);
  const opts: ScopeOption[] = [];
  for (const f of r.families) {
    const ids = r.members.filter((m) => m.family_id === f.id).map((m) => m.person_id);
    opts.push({ id: "family:" + f.id, label: f.name, people: ids, kind: "family" });
  }
  if (ledger.people.length > 1 && !r.families.length) opts.push({ id: "all", label: "Everyone", people: ledger.people.map((p) => p.id), kind: "all" });
  if (me) opts.push({ id: "person:" + me.id, label: "Me", people: [me.id], kind: "me" });
  for (const p of ledger.people) if (!p.isMe) opts.push({ id: "person:" + p.id, label: p.name, people: [p.id], kind: "person" });
  return opts;
}
