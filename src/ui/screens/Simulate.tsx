import { useEffect, useMemo, useRef, useState } from "react";
import { BUCKET_LABEL, LT, PATHS, simDefaults, type Mix, type PathId, type SimOptions, type SimResult } from "../../engine";
import { useData } from "../../data/store";
import { pct, short } from "../../lib/format";
import { Plot } from "../components/Plot";
import { Dot, Empty, bcolor } from "../components/kit";

const PCOLOR: Record<PathId, string> = { current: "var(--p-current)", target: "var(--p-target)", safe: "var(--p-safe)", growth: "var(--p-growth)", custom: "var(--p-custom)" };

export function Simulate() {
  const { ledger, scope } = useData();
  const defaults = useMemo(() => (ledger && scope ? simDefaults(ledger, new Set(scope.people)) : { monthly: 0, stepUp: 7 }), [ledger, scope]);
  const [years, setYears] = useState(15);
  const [monthly, setMonthly] = useState<number | null>(null);
  const [stepUp, setStepUp] = useState<number | null>(null);
  const [target, setTarget] = useState(10000000);
  const [payGoals, setPayGoals] = useState(true);
  const [real, setReal] = useState(false);
  const [show, setShow] = useState<Record<PathId, boolean>>({ current: true, target: true, safe: true, growth: true, custom: false });
  const [focus, setFocus] = useState<PathId>("target");
  const [custom, setCustom] = useState<Partial<Mix>>(() => ({ ...(ledger?.settings.targets.balanced ?? {}) }));
  const [res, setRes] = useState<SimResult | null>(null);
  const [err, setErr] = useState("");
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);

  useEffect(() => { setMonthly(null); setStepUp(null); }, [scope?.id]);
  useEffect(() => {
    worker.current = new Worker(new URL("../../engine/sim.worker.ts", import.meta.url), { type: "module" });
    worker.current.onmessage = (e) => { if (e.data.id === reqId.current) { if (e.data.error) setErr(e.data.error); else { setRes(e.data.result); setErr(""); } } };
    return () => worker.current?.terminate();
  }, []);

  const paths = PATHS.filter((p) => show[p.id]).map((p) => p.id);
  const opts: SimOptions = { years, monthly: monthly ?? defaults.monthly, stepUp: stepUp ?? defaults.stepUp, payGoals, real, target, paths, custom };
  const key = JSON.stringify([opts, scope?.people]);
  useEffect(() => {
    if (!ledger || !scope || !worker.current) return;
    const t = setTimeout(() => { reqId.current++; worker.current!.postMessage({ id: reqId.current, ledger, people: scope.people, opts }); }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ledger]);

  if (!ledger || !scope) return null;
  const fx = (x: string) => Number(x.replace(/,/g, "")) || 0;
  const visible = paths.filter((id) => res?.paths[id]);
  const fid = res?.paths[focus] ? focus : visible[0];
  const fp = fid ? res?.paths[fid] : undefined;

  return (
    <div className="grid">
      <section className="panel span2">
        <div className="panel-h"><div><h2>Simulator</h2><p className="muted small">240 market paths per strategy for {scope.label}. Existing holdings stay where they are; each strategy only changes where new money goes.</p></div></div>
        <div className="controls">
          <label className="field">Years ahead <span className="num" style={{ color: "var(--ink)" }}>{years}</span><input type="range" min={1} max={30} value={years} onChange={(e) => setYears(+e.target.value)} /></label>
          <label className="field">New money each month (₹)<input type="number" inputMode="numeric" step={1000} value={monthly ?? defaults.monthly} onChange={(e) => setMonthly(fx(e.target.value))} /></label>
          <label className="field">Yearly step-up (%)<input type="number" inputMode="decimal" value={stepUp ?? defaults.stepUp} onChange={(e) => setStepUp(fx(e.target.value))} /></label>
          <label className="field">Target corpus (₹)<input type="number" inputMode="numeric" step={100000} value={target} onChange={(e) => setTarget(fx(e.target.value))} /></label>
        </div>
        <div className="row" style={{ gap: "8px 20px" }}>
          <label className="check"><input type="checkbox" checked={payGoals} onChange={(e) => setPayGoals(e.target.checked)} /> Pay for goals when they fall due</label>
          <label className="check"><input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} /> Show in today's money ({ledger.settings.inflation}% inflation)</label>
        </div>
        <div className="row"><span className="eyebrow">Strategies for new money</span>
          {PATHS.map((p) => <button key={p.id} className="chip" aria-pressed={show[p.id]} onClick={() => { setShow({ ...show, [p.id]: !show[p.id] }); if (!show[p.id]) setFocus(p.id); }}><Dot color={PCOLOR[p.id]} />{p.name}</button>)}
        </div>
        {show.custom && (
          <div className="mix">
            {LT.map((b) => (
              <div key={b} className="mixrow"><span><Dot color={bcolor(b)} /> {BUCKET_LABEL[b]}</span>
                <input type="range" min={0} max={100} step={5} value={custom[b] ?? 0} aria-label={`${BUCKET_LABEL[b]} share`} onChange={(e) => setCustom({ ...custom, [b]: +e.target.value })} />
                <span className="num">{custom[b] ?? 0}%</span></div>
            ))}
          </div>
        )}
      </section>
      {err && <div className="span2 note bad">{err}</div>}
      {!res || !fp || !fid ? <div className="span2"><Empty>{visible.length || !res ? "Running the simulation…" : "Turn on at least one strategy."}</Empty></div> : (
        <>
          <section className="panel span2">
            <div className="panel-h"><h2>Where each strategy could land</h2><span className="muted small">Lines are median outcomes · band is 10th–90th percentile for {PATHS.find((p) => p.id === fid)!.name} · dashed line is the {short(target)} target</span></div>
            <Comparison res={res} ids={visible} focus={fid} target={target} />
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Strategy</th><th>New money split</th><th className="r">Bad case</th><th className="r">Median</th><th className="r">Good case</th><th className="r">Reaches {short(target)}</th>{payGoals && res.goals.length > 0 && <th className="r">Goals paid</th>}</tr></thead>
                <tbody>
                  {visible.map((id) => {
                    const p = res.paths[id]!;
                    const L = res.points - 1;
                    return (
                      <tr key={id} style={{ cursor: "pointer" }} onClick={() => setFocus(id)}>
                        <td><Dot color={PCOLOR[id]} /> {PATHS.find((x) => x.id === id)!.name}{id === fid && <> <span className="tag">shown below</span></>}</td>
                        <td><div className="stack" style={{ height: 8, minWidth: 90 }}>{LT.map((b) => <span key={b} style={{ width: `${(p.weights[b] * 100).toFixed(1)}%`, background: bcolor(b) }} />)}</div></td>
                        <td className="r num">{short(p.p10[L])}</td><td className="r num"><b>{short(p.p50[L])}</b></td><td className="r num">{short(p.p90[L])}</td>
                        <td className="r num">{pct(p.hitTarget)}</td>{payGoals && res.goals.length > 0 && <td className="r num">{p.goalsPaid == null ? "—" : pct(p.goalsPaid)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">Tap a row to break it down below. {real ? "Values are in today's money." : "Values are in future rupees, not adjusted for inflation."} New money: {short(opts.monthly)}/month, stepping up {opts.stepUp}% a year, plus existing SIPs and salary deductions. Goal withdrawals come from cash first, then debt, gold, international, equity; in real life EPF and PPF are locked.</p>
          </section>
          <section className="panel span2">
            <div className="panel-h"><h2>{PATHS.find((p) => p.id === fid)!.name}: what each asset type grows into</h2><span className="muted small">average across market paths</span></div>
            <Stacked res={res} id={fid} />
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Asset type</th><th className="r">Today</th><th className="r">Bad case</th><th className="r">Median</th><th className="r">Good case</th><th className="r">Share at end</th></tr></thead>
                <tbody>
                  {fp.final.map((x) => {
                    const tot = fp.final.reduce((t, y) => t + y.mean, 0);
                    return <tr key={x.bucket}><td><Dot color={bcolor(x.bucket)} /> {BUCKET_LABEL[x.bucket]}</td><td className="r num">{short(x.start)}</td><td className="r num">{short(x.p10)}</td><td className="r num">{short(x.p50)}</td><td className="r num">{short(x.p90)}</td><td className="r num">{pct(tot ? x.mean / tot : 0)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">Returns and volatility come from the assumptions in Settings; equity and international move together, the rest move independently. Property is left out.</p>
          </section>
        </>
      )}
    </div>
  );
}

function yearTicks(res: SimResult) {
  const yrs = res.months / 12;
  const n = Math.min(6, Math.floor(yrs) + 1);
  const now = new Date().getFullYear();
  return Array.from({ length: n }, (_, i) => {
    const y = Math.round((i * yrs) / Math.max(1, n - 1));
    return { x: y, label: y === 0 ? "Now" : String(now + y), anchor: (i === 0 ? "start" : i === n - 1 ? "end" : "middle") as "start" | "middle" | "end" };
  });
}

function Comparison({ res, ids, focus, target }: { res: SimResult; ids: PathId[]; focus: PathId; target: number }) {
  const xs = res.years;
  const fp = res.paths[focus]!;
  const yMax = Math.max(...ids.map((id) => Math.max(...res.paths[id]!.p90)), target * 1.02) * 1.03;
  return (
    <Plot label="Projected value by strategy" w={720} h={280} xMin={0} xMax={res.months / 12} yMax={yMax}
      areas={[{ color: PCOLOR[focus], opacity: 0.13, hi: xs.map((x, i) => [x, fp.p90[i]]), lo: xs.map((x, i) => [x, fp.p10[i]]) }]}
      lines={[...ids.map((id) => ({ color: PCOLOR[id], pts: xs.map((x, i) => [x, res.paths[id]!.p50[i]] as [number, number]), width: id === focus ? 2.6 : 1.6, end: true })),
        { color: "var(--muted)", pts: [[0, target], [res.months / 12, target]], width: 1, dash: "4 4" }]}
      marks={res.goals.map((g) => ({ x: g.month / 12, label: g.name }))} xTicks={yearTicks(res)} />
  );
}

function Stacked({ res, id }: { res: SimResult; id: PathId }) {
  const p = res.paths[id]!;
  const xs = res.years;
  let acc = xs.map(() => 0);
  const areas = LT.map((b) => {
    const hi = acc.map((v, k) => v + Math.max(0, p.bucketMean[b][k]));
    const a = { color: bcolor(b), opacity: 0.85, hi: xs.map((x, k) => [x, hi[k]] as [number, number]), lo: xs.map((x, k) => [x, acc[k]] as [number, number]) };
    acc = hi;
    return a;
  });
  return <Plot label="Average value by asset type" w={720} h={240} xMin={0} xMax={res.months / 12} yMax={Math.max(...acc) * 1.05} areas={areas} xTicks={yearTicks(res)} />;
}
