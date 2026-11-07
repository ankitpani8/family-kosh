import { BUCKET_LABEL, LIQ_LABEL, LT, aggregate, daysBetween, lastUpdated, nextMonth, scopeCashflow, targetWeights, timeline, type Bucket, type Ledger, type Liquidity, type Scope } from "../../engine";
import { useData } from "../../data/store";
import { canEditHolding } from "../../data/model";
import { MONTHS, fmtMonth, inr, pct, short } from "../../lib/format";
import { Plot } from "../components/Plot";
import { Dot, Empty, bcolor } from "../components/kit";
import { useSheet } from "../sheets";

const LIQ_ORDER: Liquidity[] = ["instant", "week", "locked", "illiquid"];
const LIQ_OPACITY = [0.9, 0.6, 0.38, 0.2];

export function Overview({ go }: { go: (tab: string) => void }) {
  const { ledger, scope } = useData();
  if (!ledger || !scope) return null;
  const S: Scope = new Set(scope.people);
  const a = aggregate(ledger, S);
  const targets = targetWeights(ledger, S);
  return (
    <div className="grid">
      <section className="panel span2">
        <div className="panel-h"><h2>Net worth over time</h2><span className="muted small">{scope.label} · {inr(a.nw)}</span></div>
        <Trend ledger={ledger} scope={S} />
      </section>
      <section className="panel">
        <div className="panel-h"><h2>What it's in</h2><span className="muted small">{short(a.investable + a.illiquid)} owned</span></div>
        <Allocation bucket={a.bucket} targets={targets} />
        {a.illiquid > 0 && (
          <div className="lrow"><Dot color={bcolor("property")} /><span>Property (outside the mix)</span><span className="v">{short(a.illiquid)}</span><span /></div>
        )}
      </section>
      <section className="panel">
        <div className="panel-h"><h2>Where it lives</h2><span className="muted small">by platform or place</span></div>
        <BarList obj={a.place} />
      </section>
      <section className="panel">
        <div className="panel-h"><h2>How fast you can reach it</h2></div>
        <Liquidity liq={a.liq} />
      </section>
      <section className="panel">
        <div className="panel-h"><h2>{fmtMonth(nextMonth(ledger.today))}</h2><button className="linkish" onClick={() => go("plan")}>Open plan</button></div>
        <CashCard ledger={ledger} scope={S} />
      </section>
      <section className="panel">
        <div className="panel-h"><h2>Needs attention</h2></div>
        <Attention ledger={ledger} scope={S} />
      </section>
    </div>
  );
}

function Trend({ ledger, scope }: { ledger: Ledger; scope: Scope }) {
  const tl = timeline(ledger, scope);
  if (tl.length < 2) return <Empty>The trend starts today. Each time you update a value or a unit price, a new point lands here.</Empty>;
  const xs = tl.map((p) => Date.parse(p.d));
  const ys = tl.map((p) => p.v);
  const lo = Math.min(0, ...ys);
  const n = Math.min(5, tl.length);
  const ticks = Array.from({ length: n }, (_, i) => {
    const j = Math.round((i * (tl.length - 1)) / (n - 1));
    const [y, m, d] = tl[j].d.split("-");
    return { x: xs[j], label: tl.length < 6 ? `${+d} ${MONTHS[+m - 1]}` : `${MONTHS[+m - 1]} ${y.slice(2)}`, anchor: (i === 0 ? "start" : i === n - 1 ? "end" : "middle") as "start" | "middle" | "end" };
  });
  return (
    <Plot label="Net worth over time" xMin={xs[0]} xMax={xs[xs.length - 1]} yMin={lo} yMax={Math.max(...ys) * 1.05}
      areas={[{ color: "var(--accent)", opacity: 0.12, hi: xs.map((x, i) => [x, ys[i]]), lo: xs.map((x) => [x, lo]) }]}
      lines={[{ color: "var(--accent)", pts: xs.map((x, i) => [x, ys[i]]), width: 2.2, end: true }]} xTicks={ticks} />
  );
}

export function Allocation({ bucket, targets }: { bucket: Partial<Record<Bucket, number>>; targets?: Record<string, number> }) {
  const order = [...LT, "alt"] as Bucket[];
  const tot = order.reduce((t, b) => t + Math.max(0, bucket[b] ?? 0), 0);
  if (!tot) return <Empty>No investable holdings with a value yet.</Empty>;
  return (
    <>
      <div className="stack" role="img" aria-label="Allocation">
        {order.filter((b) => (bucket[b] ?? 0) > 0).map((b) => <span key={b} style={{ width: `${((bucket[b]! / tot) * 100).toFixed(2)}%`, background: bcolor(b) }} />)}
      </div>
      <div className="legend">
        {order.filter((b) => (bucket[b] ?? 0) > 0 || targets?.[b]).map((b) => (
          <div key={b} className="lrow">
            <Dot color={bcolor(b)} /><span>{BUCKET_LABEL[b]}</span><span className="v">{short(bucket[b] ?? 0)}</span>
            <span className="p">{pct((bucket[b] ?? 0) / tot)}{targets?.[b] != null ? ` / ${pct(targets[b])}` : ""}</span>
          </div>
        ))}
      </div>
      {targets && <p className="muted small">Second figure is the target. Property is left out of the mix.</p>}
    </>
  );
}

function BarList({ obj }: { obj: Record<string, number> }) {
  const rows = Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <Empty>Nothing here yet.</Empty>;
  const max = rows[0][1];
  const shown = rows.slice(0, 8);
  const rest = rows.slice(8).reduce((t, [, v]) => t + v, 0);
  if (rest > 0) shown.push(["Everything else", rest]);
  return (
    <div className="hbar">
      {shown.map(([k, v]) => (
        <div key={k} className="hrow"><span>{k}</span><span className="v">{short(v)}</span><span className="track"><span style={{ width: `${((v / max) * 100).toFixed(1)}%` }} /></span></div>
      ))}
    </div>
  );
}

function Liquidity({ liq }: { liq: Partial<Record<Liquidity, number>> }) {
  const tot = LIQ_ORDER.reduce((t, k) => t + (liq[k] ?? 0), 0);
  if (!tot) return <Empty>No values yet.</Empty>;
  return (
    <>
      <div className="stack">{LIQ_ORDER.filter((k) => (liq[k] ?? 0) > 0).map((k) => <span key={k} style={{ width: `${(((liq[k] ?? 0) / tot) * 100).toFixed(2)}%`, background: "var(--ink)", opacity: LIQ_OPACITY[LIQ_ORDER.indexOf(k)] }} />)}</div>
      <div className="legend">
        {LIQ_ORDER.map((k, i) => (
          <div key={k} className="lrow"><span className="dot" style={{ background: "var(--ink)", opacity: LIQ_OPACITY[i] }} /><span>{LIQ_LABEL[k]}</span><span className="v">{short(liq[k] ?? 0)}</span><span className="p">{pct((liq[k] ?? 0) / tot)}</span></div>
        ))}
      </div>
    </>
  );
}

function CashCard({ ledger, scope }: { ledger: Ledger; scope: Scope }) {
  const c = scopeCashflow(ledger, scope);
  return (
    <>
      <div className="flow">
        <div className="frow"><span>Take-home income</span><span className="num">{inr(c.income)}</span></div>
        <div className="frow"><span>Interest paid out</span><span className="num">{inr(c.payouts)}</span></div>
        <div className="frow"><span>Spending</span><span className="num">−{inr(c.expenses ?? 0)}</span></div>
        <div className="frow"><span>Committed contributions</span><span className="num">−{inr(c.sipCash)}</span></div>
        <div className="frow total"><span>Free to invest</span><span className="num">{c.surplus == null ? "—" : inr(c.surplus)}</span></div>
        <div className="frow sub"><span>Auto-invested from salary</span><span className="num">{inr(c.sipPayroll)}</span></div>
        <div className="frow sub"><span>Expected growth on investments</span><span className="num">{inr(c.accrual)}</span></div>
        <div className="frow sub"><span>Extra needed for goals</span><span className="num">{inr(c.goalNeed)}</span></div>
      </div>
      {c.unknownSpend.length > 0 && <div className="note warn">Monthly spending isn't set for {c.unknownSpend.join(", ")}, so their income isn't counted as free cash. Set it under People.</div>}
    </>
  );
}

function Attention({ ledger, scope }: { ledger: Ledger; scope: Scope }) {
  const { remote } = useData();
  const open = useSheet();
  const items: { key: string; label: string; tag: string; warn: boolean; act: () => void }[] = [];
  for (const h of ledger.holdings) {
    if (!h.owners.some((o) => scope.has(o.personId)) || !remote || !canEditHolding(remote, h)) continue;
    const v = h.mode === "units" ? (h.units == null ? "units not entered" : ledger.prices.find((p) => p.id === h.priceSeriesId)?.price == null ? "unit price not set" : null) : h.value == null ? "value not entered" : null;
    if (v) { items.push({ key: h.id, label: h.name, tag: v, warn: true, act: () => open({ kind: "update", holding: h }) }); continue; }
    if (h.estimate) { items.push({ key: h.id, label: h.name, tag: "estimate, confirm", warn: false, act: () => open({ kind: "update", holding: h }) }); continue; }
    const lu = lastUpdated(h);
    const ds = lu ? daysBetween(lu, ledger.today) : Infinity;
    if (ds > 45) items.push({ key: h.id, label: h.name, tag: lu ? `updated ${ds} days ago` : "never updated", warn: false, act: () => open({ kind: "update", holding: h }) });
  }
  for (const p of ledger.prices) {
    if (!ledger.holdings.some((h) => h.priceSeriesId === p.id && h.owners.some((o) => scope.has(o.personId)))) continue;
    const lu = p.history[p.history.length - 1]?.d;
    if (p.price == null) items.push({ key: p.id, label: p.label, tag: "price not set", warn: true, act: () => open({ kind: "price", seriesId: p.id }) });
    else if (lu && daysBetween(lu, ledger.today) > 30) items.push({ key: p.id, label: p.label, tag: `price is ${daysBetween(lu, ledger.today)} days old`, warn: false, act: () => open({ kind: "price", seriesId: p.id }) });
  }
  if (!items.length) return <div className="note good">Every value is current.</div>;
  return (
    <div className="hbar">
      {items.slice(0, 15).map((it) => (
        <div key={it.key} className="frow">
          <span>{it.label} <span className={"tag" + (it.warn ? " warn" : "")}>{it.tag}</span></span>
          <button className="linkish" onClick={it.act}>Update</button>
        </div>
      ))}
      {items.length > 15 && <p className="muted small">and {items.length - 15} more</p>}
    </div>
  );
}
