// Export one or more people as a Family Kosh file that another account can import as people it manages.
// Joint holdings with someone outside the export are cut down to the exported share, so nothing is
// double-counted, and contributions paid by someone outside the export are dropped.
import { factor, type Ledger } from "../engine";
import type { KoshExport } from "./importKosh";

export function buildExport(ledger: Ledger, personIds: string[]): KoshExport {
  const set = new Set(personIds);
  const out: KoshExport = { members: {}, holdings: {}, prices: {}, goals: {} };
  ledger.people.filter((p) => set.has(p.id)).forEach((p, i) => {
    out.members[p.id] = { name: p.name, relation: p.isMe ? "" : p.relation, color: p.color, risk: p.risk, income: p.income, expenses: p.expenses, notes: p.notes, order: i };
  });
  const usedPrices = new Set<string>();
  for (const h of ledger.holdings) {
    const inside = h.owners.filter((o) => set.has(o.personId));
    if (!inside.length) continue;
    const share = factor(h, set);
    const partial = share < 0.9999;
    const scale = (v: number | null | undefined) => (v == null ? v : +(v * share).toFixed(4));
    const paidOutside = !!h.paidBy && !set.has(h.paidBy);
    if (h.priceSeriesId) usedPrices.add(h.priceSeriesId);
    const notes = [h.notes, partial ? `Exported share (${Math.round(share * 100)}%) of a joint holding.` : "", paidOutside && h.sip ? "Monthly contribution is paid by someone outside this export, so it was left out." : ""].filter(Boolean).join(" ");
    out.holdings[h.id] = {
      name: h.name, cls: h.cls, place: h.place, owners: inside.map((o) => o.personId), mode: h.mode,
      value: partial ? scale(h.value) : h.value, units: partial ? scale(h.units) : h.units, priceKey: h.priceSeriesId,
      rate: h.rate, liq: h.liq, payout: h.payout, sip: paidOutside ? null : partial ? scale(h.sip) : h.sip, sipSource: h.sipSource,
      paidBy: paidOutside ? null : h.paidBy, includeInNW: h.includeInNW, estimate: h.estimate, notes,
      history: h.history.map((x) => ({ d: x.d, v: partial ? scale(x.v) : x.v, u: partial ? scale(x.u) : x.u })),
    };
  }
  for (const p of ledger.prices) if (usedPrices.has(p.id)) out.prices[p.id] = { label: p.label, unit: p.unit, price: p.price, note: p.note, history: p.history };
  for (const g of ledger.goals) {
    if (!set.has(g.personId)) continue;
    out.goals[g.id] = { name: g.name, owner: g.personId, target: g.target, date: g.date, notes: g.notes, linked: g.linked.filter((id) => out.holdings[id]) };
  }
  return out;
}

export function exportFileName(names: string[]): string {
  const slug = names.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "people";
  return `family-kosh-${slug}.json`;
}
