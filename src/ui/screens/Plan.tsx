import { useRef, useState } from "react";
import { BUCKET_LABEL, CLASSES, LT, RISK_LABEL, aggregate, factor, nextMonth, recommend, valueOf } from "../../engine";
import { secondOpinion } from "../../data/api";
import { editablePeople } from "../../data/model";
import { useData } from "../../data/store";
import { fmtMonth, inr, pct, short } from "../../lib/format";
import { Dot, bcolor } from "../components/kit";
import { useSheet } from "../sheets";

export function Plan({ go }: { go: (tab: string) => void }) {
  const { ledger, remote, scope, selfId } = useData();
  const open = useSheet();
  const [pid, setPid] = useState<string | null>(null);
  if (!ledger || !remote) return null;
  const people = ledger.people;
  const fallback = (scope?.people.length === 1 ? scope.people[0] : null) ?? selfId ?? people[0]?.id;
  const id = pid && people.some((p) => p.id === pid) ? pid : fallback;
  const person = people.find((p) => p.id === id);
  if (!person) return null;
  const canEdit = editablePeople(remote).has(person.id);
  const r = recommend(ledger, person.id);
  const cf = r.cf;
  const placed = r.steps.reduce((t, s) => t + s.amount, 0);
  const afterTotal = LT.reduce((t, b) => t + r.after[b], 0);
  const peopleName = (ids: string[]) => ids.map((x) => people.find((p) => p.id === x)?.name).filter(Boolean).join(" & ");
  const A = ledger.settings.assumptions;

  return (
    <>
      <div className="row"><span className="eyebrow">Plan for</span>
        {people.map((p) => <button key={p.id} className="chip" aria-pressed={p.id === person.id} onClick={() => setPid(p.id)}><Dot color={p.color} />{p.name}</button>)}
      </div>
      <div className="grid">
        <section className="panel">
          <div className="panel-h"><h2>{fmtMonth(nextMonth(ledger.today))} for {person.name}</h2></div>
          <div className="flow">
            <div className="frow"><span>Take-home income</span><span className="num">{inr(cf.income)}</span></div>
            <div className="frow"><span>Interest paid out</span><span className="num">{inr(cf.payouts)}</span></div>
            <div className="frow"><span>Spending</span><span className="num">{cf.expenses == null ? "not set" : "−" + inr(cf.expenses)}</span></div>
            {cf.contributions.filter((c) => c.source === "cash").map((c) => (
              <div key={c.holding.id} className="frow sub"><span>{c.holding.name}{c.toOther ? ` (to ${peopleName(c.holding.owners.map((o) => o.personId))})` : ""}</span><span className="num">−{inr(c.amount)}</span></div>
            ))}
            <div className="frow total"><span>Free to invest</span><span className="num">{cf.surplus == null ? "—" : inr(cf.surplus)}</span></div>
            {cf.contributions.filter((c) => c.source === "payroll").map((c) => (
              <div key={c.holding.id} className="frow sub"><span>{c.holding.name} (from salary)</span><span className="num">{inr(c.amount)}</span></div>
            ))}
            <div className="frow sub"><span>Expected growth on what's invested</span><span className="num">{inr(cf.accrual)}</span></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Goals</h2>{canEdit && <button className="linkish" onClick={() => open({ kind: "goal", ownerId: person.id })}>Add goal</button>}</div>
          {cf.goals.length ? cf.goals.map((gs) => (
            <div key={gs.goal.id} style={{ display: "grid", gap: 6 }}>
              <div className="panel-h"><span style={{ fontWeight: 500 }}>{gs.goal.name}</span><span className="num small">{short(gs.saved)} of {short(gs.goal.target)}</span></div>
              <div className="progress"><span style={{ width: `${(gs.pct * 100).toFixed(1)}%` }} /></div>
              <p className="muted small">
                {gs.overdue ? "Date has passed" : `${fmtMonth(gs.goal.date)} · ${gs.months} months left`} ·{" "}
                {gs.onTrack ? <><span className="tag good">on track</span>{gs.contrib ? ` with ${inr(gs.contrib)}/month going in` : ""}</>
                  : `short by ${inr(gs.overdue ? gs.gap : gs.monthly)}/month${gs.contrib ? ` after ${inr(gs.contrib)}/month going in` : ""}`}
                {gs.goal.linked.length ? "" : " · no savings linked yet"}
                {canEdit && <> · <button className="linkish" onClick={() => open({ kind: "goal", goal: gs.goal })}>Edit</button></>}
                {gs.goal.notes && <><br />{gs.goal.notes}</>}
              </p>
            </div>
          )) : <p className="muted small">No goals for {person.name}.</p>}
        </section>

        {r.blocked ? (
          <section className="panel span2">
            <h2>Where the money should go</h2>
            <div className="note warn">{person.name}'s monthly spending isn't set, so there's no free cash to plan.</div>
            {canEdit && <button className="btn ghost" style={{ justifySelf: "start" }} onClick={() => open({ kind: "person", person })}>Set spending</button>}
          </section>
        ) : (
          <section className="panel span2">
            <div className="panel-h">
              <div><h2>Where the next {short(r.available)} should go</h2><p className="muted small">Rules engine v1 · {RISK_LABEL[person.risk]} profile · signals: {ledger.settings.signalSource}</p></div>
              <span className="num">{inr(placed)} placed</span>
            </div>
            {r.notes.map((n, i) => <div key={i} className={"note " + n.level}>{n.text}</div>)}
            {r.steps.length ? (
              <div>
                {r.steps.map((s, i) => (
                  <div key={i} className="step">
                    <span className="sw" style={{ background: bcolor(s.bucket) }} />
                    <div><div className="eyebrow">{s.kind}</div><div style={{ fontWeight: 500 }}>{s.hint}</div></div>
                    <div className="amt">{inr(s.amount)}</div>
                    <div className="why">{s.why}</div>
                  </div>
                ))}
              </div>
            ) : <div className="note">Nothing to place this month.</div>}
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Long-term mix</th><th className="r">Now</th><th className="r">Target</th><th className="r">After this month</th></tr></thead>
                <tbody>
                  {LT.map((b) => (
                    <tr key={b}><td><Dot color={bcolor(b)} /> {BUCKET_LABEL[b]}</td>
                      <td className="r num">{r.longTermTotal ? pct(r.current[b] / r.longTermTotal) : "—"}</td>
                      <td className="r num">{pct(r.weights[b])}</td>
                      <td className="r num">{afterTotal ? pct(r.after[b] / afterTotal) : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              Order: emergency money first ({ledger.settings.emergencyMonths} months of spending, {short(r.emergency.need)} needed, {short(r.emergency.liquid)} available), then goals under 7 years, then the rest fills whichever asset type is furthest below target. Goal-linked savings and the emergency reserve are kept out of the long-term mix. This is arithmetic on your own targets, not regulated advice.
            </p>
          </section>
        )}

        <SecondOpinion personId={person.id} />

        <section className="panel span2">
          <div className="panel-h"><h2>Risk and reward assumptions</h2><button className="linkish" onClick={() => go("settings")}>Edit</button></div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Asset type</th><th className="r">Expected return</th><th className="r">Volatility</th><th className="r">Return per unit of risk</th><th className="r">Signal tilt</th></tr></thead>
              <tbody>
                {LT.map((b) => {
                  const x = A[b];
                  const sc = x.vol ? (x.ret - A.cash.ret) / x.vol : null;
                  const t = ledger.settings.views[b] || 0;
                  return <tr key={b}><td><Dot color={bcolor(b)} /> {BUCKET_LABEL[b]}</td><td className="r num">{x.ret}%</td><td className="r num">{x.vol}%</td><td className="r num">{b === "cash" || sc == null ? "—" : sc.toFixed(2)}</td><td className="r num">{t > 0 ? "+" : ""}{t} pts</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">Signal tilts shift target weights. Set them by hand in Settings, or let a signal source such as InvestBot write them to the signals table.</p>
        </section>
      </div>
    </>
  );
}

function SecondOpinion({ personId }: { personId: string }) {
  const { ledger, offline } = useData();
  const [state, setState] = useState<{ busy: boolean; text: string; err: string }>({ busy: false, text: "", err: "" });
  const ref = useRef(0);
  if (!ledger) return null;
  const ask = async () => {
    const r = recommend(ledger, personId);
    const me = new Set([personId]);
    const person = ledger.people.find((p) => p.id === personId)!;
    const payload = {
      person: { name: person.name, relation: person.relation, risk: person.risk, monthlyTakeHome: person.income, monthlySpending: person.expenses, notes: person.notes },
      holdings: ledger.holdings.filter((h) => factor(h, me) > 0).map((h) => {
        const v = valueOf(ledger, h);
        return { name: h.name, type: CLASSES[h.cls]?.label, share: +factor(h, me).toFixed(2), valueINR: v == null ? null : Math.round(v * factor(h, me)), liquidity: h.liq, expectedReturnPct: h.rate, monthlyContribution: h.sip ?? 0, estimate: h.estimate, notes: h.notes };
      }),
      netWorth: Math.round(aggregate(ledger, me).nw),
      nextMonth: { freeToInvest: Math.round(r.cf.surplus ?? 0), payrollAutoInvest: Math.round(r.cf.sipPayroll) },
      goals: r.cf.goals.map((g) => ({ name: g.goal.name, target: g.goal.target, by: g.goal.date, saved: Math.round(g.saved), alreadyGoingInPerMonth: g.contrib, shortPerMonth: Math.round(g.monthly) })),
      engine: { steps: r.steps.map((s) => ({ what: s.kind, assetType: s.bucket, amountINR: s.amount, instrument: s.hint })), warnings: r.notes.map((n) => n.text), targetMix: r.weights },
      assumptions: ledger.settings.assumptions,
    };
    const prompt = `You are reviewing next month's money plan for one member of an Indian family. A deterministic rules engine produced the plan below (emergency fund first, then goals under 7 years, then fill the asset type furthest below target). Challenge it.\n\nReply in plain text, under 200 words, using "- " bullets:\n- One line: do you agree with the engine overall?\n- Up to 4 specific changes with rupee amounts and why (consider Indian tax rules, PPF/ELSS limits and lock-ins, goal timing, concentration, liquidity, insurance gaps).\n- One line on what data is missing that would change the answer.\nYou are giving reasoning for the person to weigh, not regulated advice.\n\nDATA (JSON):\n${JSON.stringify(payload)}`;
    const run = ++ref.current;
    setState({ busy: true, text: "", err: "" });
    try {
      const text = await secondOpinion(prompt);
      if (run === ref.current) setState({ busy: false, text, err: "" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (run === ref.current) setState({ busy: false, text: "", err: /not found|404|Failed to send/i.test(msg) ? "The Claude review isn't set up on the server yet. See the README's \"Second opinion\" section." : msg });
    }
  };
  return (
    <section className="panel span2">
      <div className="panel-h">
        <div><h2>Second opinion from Claude</h2><p className="muted small">Sends this plan's numbers to Claude through your own server function and asks it to challenge them.</p></div>
        <button className="btn ghost" onClick={ask} disabled={state.busy || offline}>{state.busy ? "Thinking…" : "Ask Claude"}</button>
      </div>
      {state.err ? <div className="note warn">{state.err}</div> : state.text ? <Bullets text={state.text} /> : <p className="muted small">No review yet.</p>}
    </section>
  );
}

function Bullets({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const items = lines.filter((l) => /^[-•*]\s+/.test(l)).map((l) => l.replace(/^[-•*]\s+/, "").replace(/\*\*/g, ""));
  const paras = lines.filter((l) => !/^[-•*]\s+/.test(l)).map((l) => l.replace(/\*\*/g, ""));
  return <div className="ai-out">{paras.map((p, i) => <p key={i}>{p}</p>)}{items.length > 0 && <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>}</div>;
}
