import { useState } from "react";
import { BUCKET_LABEL, CLASSES, bucketOf, factor, lastUpdated, rateOf, valueOf, type Holding } from "../../engine";
import { canEditHolding } from "../../data/model";
import { useData } from "../../data/store";
import { fmtDate, inr, pct, short } from "../../lib/format";
import { Dot, Empty, bcolor } from "../components/kit";
import { useSheet } from "../sheets";

type GroupBy = "place" | "owner" | "type";

export function Holdings() {
  const { ledger, remote, scope } = useData();
  const open = useSheet();
  const [group, setGroup] = useState<GroupBy>(() => { try { return (localStorage.getItem("kosh:group") as GroupBy) || "place"; } catch { return "place"; } });
  if (!ledger || !remote || !scope) return null;
  const S = new Set(scope.people);
  const personName = (id: string) => ledger.people.find((p) => p.id === id)?.name ?? "Someone";
  const list = ledger.holdings.filter((h) => factor(h, S) > 0);
  const keyOf = (h: Holding) =>
    group === "place" ? h.place || "Unspecified"
    : group === "type" ? BUCKET_LABEL[bucketOf(h)]
    : h.owners.length > 1 ? "Joint · " + h.owners.map((o) => personName(o.personId)).join(" & ") : personName(h.owners[0]?.personId);
  const groups: Record<string, Holding[]> = {};
  for (const h of list) (groups[keyOf(h)] ??= []).push(h);
  const sum = (hs: Holding[]) => hs.reduce((t, h) => { const v = valueOf(ledger, h); return t + (v == null || !h.includeInNW ? 0 : v * factor(h, S)); }, 0);
  const keys = Object.keys(groups).sort((a, b) => sum(groups[b]) - sum(groups[a]));
  const setG = (g: GroupBy) => { setGroup(g); try { localStorage.setItem("kosh:group", g); } catch { /* ignore */ } };

  return (
    <div className="grid">
      <section className="panel span2">
        <div className="panel-h">
          <div className="row"><span className="eyebrow">Group by</span>
            {(["place", "owner", "type"] as GroupBy[]).map((g) => <button key={g} className="chip" aria-pressed={group === g} onClick={() => setG(g)}>{g === "place" ? "Place" : g === "owner" ? "Owner" : "Asset type"}</button>)}
          </div>
          <button className="btn" onClick={() => open({ kind: "holding" })}>Add holding</button>
        </div>
        {keys.length ? keys.map((k) => (
          <div key={k}>
            <div className="group-h"><h3>{k}</h3><span className="num">{short(sum(groups[k]))}</span></div>
            {groups[k].map((h) => <Row key={h.id} h={h} S={S} />)}
          </div>
        )) : <Empty>No holdings for {scope.label} yet. Add a bank account, fund, FD, gold, land or anything else.</Empty>}
      </section>
      <Prices />
    </div>
  );
}

function Row({ h, S }: { h: Holding; S: Set<string> }) {
  const { ledger, remote } = useData();
  const open = useSheet();
  if (!ledger || !remote) return null;
  const v = valueOf(ledger, h);
  const f = factor(h, S);
  const lu = lastUpdated(h);
  const editable = canEditHolding(remote, h);
  const series = ledger.prices.find((p) => p.id === h.priceSeriesId);
  const payer = h.paidBy && !h.owners.some((o) => o.personId === h.paidBy) ? ledger.people.find((p) => p.id === h.paidBy)?.name : null;
  return (
    <div className={"hold" + (h.includeInNW ? "" : " off")}>
      <div className="nm">{h.name}</div>
      <div className="v">
        {v == null ? <span className="tag warn">needs a value</span> : inr(v * f)}
        {f < 1 && v != null && <div className="muted small">{pct(f)} share of {short(v)}</div>}
      </div>
      <div className="meta">
        <span className="tag"><Dot color={bcolor(bucketOf(h))} />{CLASSES[h.cls]?.label ?? h.cls}</span>
        {h.owners.map((o) => { const p = ledger.people.find((x) => x.id === o.personId); return p ? <span key={o.personId} className="row" style={{ gap: 4 }}><Dot color={p.color} />{p.name}</span> : null; })}
        {h.mode === "units" && <span className="mono">{h.units == null ? "?" : Number(h.units).toLocaleString("en-IN")} {series?.unit ?? "units"} × {series?.price != null ? inr(series.price) : "?"}</span>}
        <span>{rateOf(h)}%/yr{h.payout ? " paid out" : ""}</span>
        {h.sip ? <span>+{short(h.sip)}/mo{h.sipSource === "payroll" ? " from salary" : ""}{payer ? ` paid by ${payer}` : ""}</span> : null}
        {h.estimate && <span className="tag warn">estimate</span>}
        {h.private && <span className="tag">private</span>}
        {!h.includeInNW && <span className="tag">not counted</span>}
        <span>{lu ? "updated " + fmtDate(lu) : "never updated"}</span>
        {editable && (
          <span className="acts">
            <button className="btn sm ghost" onClick={() => open({ kind: "update", holding: h })}>Update</button>
            <button className="btn sm ghost" onClick={() => open({ kind: "holding", holding: h })}>Edit</button>
          </span>
        )}
      </div>
      {h.notes && <div className="meta">{h.notes}</div>}
    </div>
  );
}

function Prices() {
  const { ledger } = useData();
  const open = useSheet();
  if (!ledger) return null;
  const prices = [...ledger.prices].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <section className="panel span2">
      <div className="panel-h">
        <div><h2>Unit prices</h2><p className="muted small">Anything tracked in units (grams of gold, square feet, euros, ETF units) is valued with these. Update a price once and every holding using it moves.</p></div>
        <button className="btn ghost" onClick={() => open({ kind: "price" })}>Add unit price</button>
      </div>
      {prices.length ? (
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Series</th><th className="r">Price per unit</th><th>Updated</th><th className="r">Used by</th><th /></tr></thead>
            <tbody>
              {prices.map((p) => (
                <tr key={p.id}>
                  <td>{p.label}<div className="muted small">per {p.unit}{p.note ? " · " + p.note : ""}</div></td>
                  <td className="r num">{p.price == null ? <span className="tag warn">not set</span> : inr(p.price)}</td>
                  <td className="small">{fmtDate(p.history[p.history.length - 1]?.d)}</td>
                  <td className="r">{ledger.holdings.filter((h) => h.priceSeriesId === p.id).length}</td>
                  <td className="r"><button className="btn sm ghost" onClick={() => open({ kind: "price", seriesId: p.id })}>Update</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>No unit prices yet.</Empty>}
    </section>
  );
}
