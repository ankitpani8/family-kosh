// Edit forms shown in a bottom sheet: holdings, value updates, unit prices, people and goals.
import { useState, type FormEvent } from "react";
import { CLASSES, LIQ_LABEL, MEMBER_COLORS, RISK_LABEL, valueOf, type Goal, type Holding, type HoldingClass, type Liquidity, type Person, type Risk } from "../engine";
import * as api from "../data/api";
import { editablePeople } from "../data/model";
import { useData, useMutate } from "../data/store";
import { fmtDate, inr, num, short } from "../lib/format";
import { DeleteButton, Dot, Modal, useToast } from "./components/kit";

function useSubmit(onDone: () => void) {
  const mutate = useMutate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, okMsg = "Saved") => {
    setBusy(true);
    const err = await mutate(fn);
    setBusy(false);
    if (err) toast(err, true);
    else { toast(okMsg); onDone(); }
  };
  return { busy, run };
}

// ───────── holding ─────────
export function HoldingForm({ holding, onClose }: { holding?: Holding; onClose: () => void }) {
  const { ledger, remote, scope, selfId } = useData();
  const toast = useToast();
  const { busy, run } = useSubmit(onClose);
  const isNew = !holding;
  const mine = remote ? editablePeople(remote) : new Set<string>();
  const defaultOwner = scope && scope.people.length === 1 ? scope.people[0] : selfId;
  const [f, setF] = useState(() => ({
    name: holding?.name ?? "", cls: (holding?.cls ?? "equity_fund") as HoldingClass, place: holding?.place ?? "",
    owners: holding?.owners.map((o) => o.personId) ?? (defaultOwner ? [defaultOwner] : []),
    shares: Object.fromEntries((holding?.owners ?? []).map((o) => [o.personId, o.share])) as Record<string, number>,
    mode: holding?.mode ?? "value", value: holding?.value?.toString() ?? "", units: holding?.units?.toString() ?? "",
    series: holding?.priceSeriesId ?? ledger?.prices[0]?.id ?? "__new", newLabel: "", newUnit: "", newPrice: "",
    rate: (holding?.rate ?? CLASSES[holding?.cls ?? "equity_fund"].rate).toString(), liq: (holding?.liq ?? CLASSES[holding?.cls ?? "equity_fund"].liq) as Liquidity,
    payout: holding?.payout ?? false, sip: holding?.sip?.toString() ?? "", sipSource: holding?.sipSource ?? "cash", paidBy: holding?.paidBy ?? "",
    includeInNW: holding?.includeInNW ?? true, estimate: holding?.estimate ?? false, private: holding?.private ?? false, notes: holding?.notes ?? "",
  }));
  if (!ledger) return null;
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const places = [...new Set(ledger.holdings.map((h) => h.place).filter(Boolean))];
  const unequal = f.owners.length > 1 && f.owners.some((id) => (f.shares[id] ?? 1) !== (f.shares[f.owners[0]] ?? 1));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return toast("Give the holding a name.", true);
    if (!f.owners.length) return toast("Pick at least one owner.", true);
    if (!f.owners.some((id) => mine.has(id))) return toast("At least one owner must be you or someone you manage.", true);
    run(async () => {
      let seriesId: string | null = null;
      if (f.mode === "units") {
        seriesId = f.series;
        if (f.series === "__new") {
          if (!f.newLabel.trim() || !f.newUnit.trim()) throw new Error("Name the new unit price and its unit.");
          seriesId = await api.createSeries(f.newLabel.trim(), f.newUnit.trim(), num(f.newPrice), "", ledger.today);
        }
      }
      await api.saveHolding(
        {
          name: f.name.trim(), cls: f.cls, place: f.place.trim(), mode: f.mode, value: f.mode === "value" ? num(f.value) : null,
          units: f.mode === "units" ? num(f.units) : null, priceSeriesId: seriesId, rate: num(f.rate), liq: f.liq, payout: f.payout,
          sip: num(f.sip), sipSource: f.sipSource, paidBy: f.paidBy || null, includeInNW: f.includeInNW, estimate: f.estimate,
          private: f.private, notes: f.notes.trim(),
        },
        f.owners.map((id) => ({ personId: id, share: f.shares[id] ?? 1 })),
        ledger.today,
        holding,
      );
    });
  };

  return (
    <Modal title={isNew ? "Add holding" : "Edit holding"} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="field">Name<input id="h-name" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Nifty 50 index fund" /></label>
        <div className="row2">
          <label className="field">Type
            <select id="h-cls" value={f.cls} onChange={(e) => { const c = e.target.value as HoldingClass; set({ cls: c, rate: String(CLASSES[c].rate), liq: CLASSES[c].liq }); }}>
              {Object.entries(CLASSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label className="field">Where it's held
            <input id="h-place" list="h-places" value={f.place} onChange={(e) => set({ place: e.target.value })} placeholder="Groww, SBI, home locker…" />
            <datalist id="h-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
        </div>
        <fieldset>
          <legend>Owned by</legend>
          {ledger.people.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={f.owners.includes(p.id)} onChange={(e) => set({ owners: e.target.checked ? [...f.owners, p.id] : f.owners.filter((x) => x !== p.id) })} />
              <Dot color={p.color} />{p.name}
            </label>
          ))}
        </fieldset>
        {f.owners.length > 1 && (
          <div className="row2">
            {f.owners.map((id) => (
              <label key={id} className="field">{ledger.people.find((p) => p.id === id)?.name}'s share
                <input type="number" min="1" step="1" value={f.shares[id] ?? 1} onChange={(e) => set({ shares: { ...f.shares, [id]: Math.max(1, Number(e.target.value) || 1) } })} />
              </label>
            ))}
            <span className="muted small">{unequal ? "Shares are relative: 3 and 1 means 75% and 25%." : "Equal shares split it evenly."}</span>
          </div>
        )}
        <fieldset>
          <legend>Track it as</legend>
          <label className="check"><input type="radio" checked={f.mode === "value"} onChange={() => set({ mode: "value" })} /> A rupee value</label>
          <label className="check"><input type="radio" checked={f.mode === "units"} onChange={() => set({ mode: "units" })} /> Units × a tracked price</label>
        </fieldset>
        {f.mode === "value" ? (
          <label className="field">Current value (₹)<input id="h-value" type="number" inputMode="decimal" value={f.value} onChange={(e) => set({ value: e.target.value })} /></label>
        ) : (
          <div className="row2">
            <label className="field">Units held<input id="h-units" type="number" inputMode="decimal" step="any" value={f.units} onChange={(e) => set({ units: e.target.value })} /></label>
            <label className="field">Priced by
              <select id="h-series" value={f.series} onChange={(e) => set({ series: e.target.value })}>
                {ledger.prices.map((p) => <option key={p.id} value={p.id}>{p.label} (per {p.unit})</option>)}
                <option value="__new">New unit price…</option>
              </select>
            </label>
            {f.series === "__new" && (
              <>
                <label className="field">Price name<input value={f.newLabel} onChange={(e) => set({ newLabel: e.target.value })} placeholder="Gold 22K" /></label>
                <label className="field">Unit<input value={f.newUnit} onChange={(e) => set({ newUnit: e.target.value })} placeholder="gram" /></label>
                <label className="field">₹ per unit<input type="number" inputMode="decimal" value={f.newPrice} onChange={(e) => set({ newPrice: e.target.value })} /></label>
              </>
            )}
          </div>
        )}
        <div className="row2">
          <label className="field">Expected return (% a year)<input type="number" step="0.1" value={f.rate} onChange={(e) => set({ rate: e.target.value })} /></label>
          <label className="field">How fast you can get it
            <select value={f.liq} onChange={(e) => set({ liq: e.target.value as Liquidity })}>
              {Object.entries(LIQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={f.payout} onChange={(e) => set({ payout: e.target.checked })} /> Interest is paid out each month (counts as income)</label>
        <div className="row2">
          <label className="field">Monthly contribution (₹)<input type="number" inputMode="decimal" value={f.sip} onChange={(e) => set({ sip: e.target.value })} placeholder="SIP, deposit, premium" /></label>
          <label className="field">Paid from
            <select value={f.sipSource} onChange={(e) => set({ sipSource: e.target.value as "cash" | "payroll" })}>
              <option value="cash">Take-home pay</option><option value="payroll">Deducted from salary</option>
            </select>
          </label>
          <label className="field">Paid by
            <select value={f.paidBy} onChange={(e) => set({ paidBy: e.target.value })}>
              <option value="">The owners</option>
              {ledger.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={f.includeInNW} onChange={(e) => set({ includeInNW: e.target.checked })} /> Count in net worth</label>
        <label className="check"><input type="checkbox" checked={f.estimate} onChange={(e) => set({ estimate: e.target.checked })} /> The value is an estimate (flag it until confirmed)</label>
        <label className="check"><input type="checkbox" checked={f.private} onChange={(e) => set({ private: e.target.checked })} /> Private: hide from family members who don't own it</label>
        <label className="field">Notes<textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
        <div className="actions">
          {!isNew && <DeleteButton onDelete={() => run(() => api.deleteHolding(holding!.id), "Deleted")} />}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ───────── quick value update ─────────
export function UpdateForm({ holding, onClose, onPrice }: { holding: Holding; onClose: () => void; onPrice: (id: string) => void }) {
  const { ledger } = useData();
  const toast = useToast();
  const { busy, run } = useSubmit(onClose);
  const units = holding.mode === "units";
  const series = ledger?.prices.find((p) => p.id === holding.priceSeriesId);
  const [v, setV] = useState(String((units ? holding.units : holding.value) ?? ""));
  const [d, setD] = useState(ledger?.today ?? "");
  if (!ledger) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = num(v);
    if (n == null) return toast("Enter a number.", true);
    run(() => api.recordSnapshot(holding.id, d || ledger.today, units ? null : n, units ? n : null), "Updated");
  };
  return (
    <Modal title={`Update ${holding.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">{units ? `Units held now (${series?.unit ?? "units"})` : "Value now (₹)"}
          <input id="u-val" type="number" step="any" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} />
        </label>
        {units && (
          <p className="muted small">
            Valued at {series?.price != null ? `${inr(series.price)} per ${series.unit}` : "a price that isn't set yet"}.{" "}
            {series && <button type="button" className="linkish" onClick={() => onPrice(series.id)}>Update the price</button>}
          </p>
        )}
        <label className="field">As of<input type="date" value={d} max={ledger.today} onChange={(e) => setD(e.target.value)} /></label>
        <p className="muted small">Each update adds a point to the history, so the trend chart fills in over time. Saving clears the "estimate" flag.</p>
        <div className="actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

// ───────── unit price ─────────
export function PriceForm({ seriesId, onClose }: { seriesId?: string; onClose: () => void }) {
  const { ledger } = useData();
  const toast = useToast();
  const { busy, run } = useSubmit(onClose);
  const s = ledger?.prices.find((p) => p.id === seriesId);
  const [f, setF] = useState({ label: s?.label ?? "", unit: s?.unit ?? "", price: s?.price?.toString() ?? "", note: s?.note ?? "", d: ledger?.today ?? "" });
  if (!ledger) return null;
  const used = s ? ledger.holdings.filter((h) => h.priceSeriesId === s.id).length : 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const price = num(f.price);
    if (!f.label.trim() || !f.unit.trim()) return toast("Name the price and its unit.", true);
    run(async () => {
      if (!s) return api.createSeries(f.label.trim(), f.unit.trim(), price, f.note.trim(), f.d);
      await api.updateSeries(s.id, f.label.trim(), f.unit.trim(), f.note.trim());
      if (price != null && (price !== s.price || f.d !== ledger.today)) await api.recordPrice(s.id, f.d, price);
    }, "Price saved");
  };
  return (
    <Modal title={s ? `Update ${s.label}` : "Add unit price"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="row2">
          <label className="field">Name<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Gold 22K" /></label>
          <label className="field">Unit<input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="gram" /></label>
          <label className="field">₹ per unit<input id="p-price" type="number" step="any" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <label className="field">As of<input type="date" value={f.d} max={ledger.today} onChange={(e) => setF({ ...f, d: e.target.value })} /></label>
        </div>
        <label className="field">Note<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Source, e.g. IBJA rate" /></label>
        {s && s.history.length > 0 && <p className="muted small">History: {s.history.slice(-6).map((x) => `${fmtDate(x.d)} ${inr(x.p)}`).join(" · ")}</p>}
        <div className="actions">
          {s && <DeleteButton onDelete={() => (used ? toast(`${used} holding${used > 1 ? "s use" : " uses"} this price. Change them first.`, true) : run(() => api.deleteSeries(s.id), "Deleted"))} />}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

// ───────── person ─────────
export function PersonForm({ person, onClose }: { person?: Person; onClose: () => void }) {
  const { ledger, session } = useData();
  const toast = useToast();
  const { busy, run } = useSubmit(onClose);
  const [f, setF] = useState({
    name: person?.name ?? "", relation: person?.relation ?? "", color: person?.color ?? MEMBER_COLORS[(ledger?.people.length ?? 0) % MEMBER_COLORS.length],
    risk: (person?.risk ?? "balanced") as Risk, income: person?.income?.toString() ?? "", expenses: person?.expenses?.toString() ?? "", notes: person?.notes ?? "",
  });
  if (!ledger || !session) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return toast("Enter a name.", true);
    run(() => api.savePerson(session.user.id, { name: f.name.trim(), relation: f.relation.trim(), color: f.color, risk: f.risk, income: num(f.income) ?? 0, expenses: num(f.expenses), notes: f.notes.trim() }, person?.id));
  };
  return (
    <Modal title={person ? `Edit ${person.name}` : "Add someone you manage"} onClose={onClose}>
      <form onSubmit={submit}>
        {!person && <p className="muted small">For someone who won't log in themselves, like a parent. You'll manage their money; they can take over later with a claim code.</p>}
        <div className="row2">
          <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">Relation<input value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value })} placeholder="Mother, Father, Fiancée…" /></label>
        </div>
        <fieldset><legend>Colour</legend>
          {MEMBER_COLORS.map((c) => (
            <label key={c} className="check"><input type="radio" name="color" checked={f.color === c} onChange={() => setF({ ...f, color: c })} /><Dot color={c} size={16} /></label>
          ))}
        </fieldset>
        <label className="field">Risk profile
          <select value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value as Risk })}>
            {Object.entries(RISK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="row2">
          <label className="field">Take-home income per month (₹)<input type="number" inputMode="numeric" value={f.income} onChange={(e) => setF({ ...f, income: e.target.value })} /></label>
          <label className="field">Spending from their own money per month (₹)<input type="number" inputMode="numeric" value={f.expenses} onChange={(e) => setF({ ...f, expenses: e.target.value })} placeholder="Blank if unknown" /></label>
        </div>
        <label className="field">Notes<textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <div className="actions">
          {person?.managedByMe && <DeleteButton onDelete={() => run(() => api.deletePerson(person.id), "Deleted")} />}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

// ───────── goal ─────────
export function GoalForm({ goal, ownerId, onClose }: { goal?: Goal; ownerId?: string; onClose: () => void }) {
  const { ledger, remote } = useData();
  const toast = useToast();
  const { busy, run } = useSubmit(onClose);
  const mine = remote ? editablePeople(remote) : new Set<string>();
  const people = ledger?.people.filter((p) => mine.has(p.id)) ?? [];
  const [f, setF] = useState({
    personId: goal?.personId ?? ownerId ?? people[0]?.id ?? "", name: goal?.name ?? "", target: goal?.target?.toString() ?? "",
    date: goal?.date ?? "", notes: goal?.notes ?? "", linked: goal?.linked ?? [],
  });
  if (!ledger) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const target = num(f.target);
    if (!f.name.trim() || target == null || !f.date) return toast("Fill in the goal, target and month.", true);
    run(() => api.saveGoal({ personId: f.personId, name: f.name.trim(), target, date: f.date, notes: f.notes.trim(), linked: f.linked }, goal?.id));
  };
  return (
    <Modal title={goal ? "Edit goal" : "Add goal"} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">Goal<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Wedding, house, car…" /></label>
        <div className="row2">
          <label className="field">Whose goal
            <select value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className="field">Target (₹)<input type="number" inputMode="numeric" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
          <label className="field">By (month)<input type="month" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        </div>
        <fieldset>
          <legend>Savings set aside for it</legend>
          {ledger.holdings.length ? ledger.holdings.map((h) => {
            const v = valueOf(ledger, h);
            return (
              <label key={h.id} className="check">
                <input type="checkbox" checked={f.linked.includes(h.id)} onChange={(e) => setF({ ...f, linked: e.target.checked ? [...f.linked, h.id] : f.linked.filter((x) => x !== h.id) })} />
                {h.name} <span className="muted small">{short(v)}{h.sip ? ` +${short(h.sip)}/mo` : ""}</span>
              </label>
            );
          }) : <span className="muted small">No holdings yet.</span>}
        </fieldset>
        <label className="field">Notes<input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <div className="actions">
          {goal && <DeleteButton onDelete={() => run(() => api.deleteGoal(goal.id), "Deleted")} />}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
