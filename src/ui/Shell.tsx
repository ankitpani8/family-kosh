import { useEffect, useState, type ReactNode } from "react";
import { aggregate, monthDelta, todayIso } from "../engine";
import { useData } from "../data/store";
import { fmtDate, inr, pct, short } from "../lib/format";
import { Dot, Empty } from "./components/kit";
import { SheetProvider } from "./sheets";
import { Overview } from "./screens/Overview";
import { Holdings } from "./screens/Holdings";
import { Plan } from "./screens/Plan";
import { Simulate } from "./screens/Simulate";
import { People } from "./screens/People";
import { Settings } from "./screens/Settings";

const TABS = [
  { id: "overview", label: "Overview", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { id: "holdings", label: "Holdings", icon: "M4 6h16M4 12h16M4 18h10" },
  { id: "plan", label: "Plan", icon: "M4 19V9m6 10V5m6 14v-7m4 7H2" },
  { id: "simulate", label: "Simulate", icon: "M3 17l5-6 4 3 8-9M15 5h5v5" },
  { id: "people", label: "People", icon: "M8 11a3 3 0 100-6 3 3 0 000 6zm8 1a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM2 20c0-3.3 2.7-6 6-6s6 2.7 6 6m1-5.5c2.8 0 5 1.8 5 4.5" },
  { id: "settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-2.2-1.3L14.4 2h-4l-.4 2.4a7.6 7.6 0 00-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 002.2 1.3l.4 2.4h4l.4-2.4a7.6 7.6 0 002.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const MOBILE_TABS: Tab[] = ["overview", "holdings", "plan", "simulate", "people"];

function readTab(): Tab {
  const h = window.location.hash.slice(1);
  return (TABS.some((t) => t.id === h) ? h : "overview") as Tab;
}

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

export function Shell() {
  const { ledger, remote, scope, scopes, setScopeId, loading, offline, error } = useData();
  const [tab, setTab] = useState<Tab>(readTab);
  useEffect(() => {
    const h = () => setTab(readTab());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const go = (t: string) => {
    window.location.hash = t;
    setTab(t as Tab);
    window.scrollTo({ top: 0 });
  };
  const status = offline ? "off" : loading && !remote ? "" : "live";
  let body: ReactNode;
  if (!ledger || !remote) body = <Empty>{error ? `Couldn't load your data: ${error}` : "Loading your ledger…"}</Empty>;
  else if (tab === "overview") body = <Overview go={go} />;
  else if (tab === "holdings") body = <Holdings />;
  else if (tab === "plan") body = <Plan go={go} />;
  else if (tab === "simulate") body = <Simulate />;
  else if (tab === "people") body = <People />;
  else body = <Settings />;
  const scoped = tab === "overview" || tab === "holdings" || tab === "simulate";

  return (
    <SheetProvider>
      <header className="top">
        <div className="wrap">
          <div className="topbar">
            <div className="brand"><span className="seal" aria-hidden="true">₹</span>Family Kosh</div>
            <div className={"sync " + status}><i /><span>{offline ? `Offline · saved ${remote ? fmtDate(remote.fetchedAt.slice(0, 10)) : ""}` : loading ? "Syncing…" : "Synced"}</span></div>
            <button className="tab" style={{ padding: 6 }} aria-label="Settings" aria-current={tab === "settings" ? "page" : undefined} onClick={() => go("settings")}><Icon d={TABS[5].icon} /></button>
          </div>
          <nav className="tabs desktop" aria-label="Sections">
            {TABS.slice(0, 5).map((t) => <button key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>{t.label}</button>)}
          </nav>
        </div>
      </header>
      <div className="wrap">
        <main>
          {error && remote && <div className="banner">Couldn't refresh: {error}</div>}
          {ledger && remote && scope && scoped && <Hero />}
          {scoped && scopes.length > 1 && (
            <div className="scopebar" role="group" aria-label="Whose money">
              {scopes.map((s) => <button key={s.id} className="chip" aria-pressed={scope?.id === s.id} onClick={() => setScopeId(s.id)}>{s.kind === "person" && <Dot color={ledger?.people.find((p) => p.id === s.people[0])?.color ?? "var(--muted)"} />}{s.label}</button>)}
            </div>
          )}
          {body}
        </main>
      </div>
      <nav className="bottom" aria-label="Sections">
        {MOBILE_TABS.map((id) => { const t = TABS.find((x) => x.id === id)!; return <button key={id} className="tab" aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}><Icon d={t.icon} />{t.label}</button>; })}
      </nav>
    </SheetProvider>
  );
}

function Hero() {
  const { ledger, scope, scopes, setScopeId } = useData();
  if (!ledger || !scope) return null;
  const S = new Set(scope.people);
  const a = aggregate(ledger, S);
  const d = monthDelta(ledger, S);
  const people = ledger.people.filter((p) => S.has(p.id));
  const total = Math.max(0, a.nw);
  const familyScope = scopes.find((s) => s.kind === "family" || s.kind === "all");
  return (
    <section className="hero">
      <div className="eyebrow">{scope.kind === "me" ? "Your net worth" : scope.kind === "person" ? `${scope.label}'s net worth` : `${scope.label} · net worth`} · {fmtDate(todayIso())}</div>
      <div className="hero-main">
        <div className="big">{inr(a.nw)}</div>
        {d && <span className={"delta " + (d.abs >= 0 ? "up" : "down")}>{d.abs >= 0 ? "+" : "−"}{short(Math.abs(d.abs))} since {fmtDate(d.since)}</span>}
      </div>
      <div className="splits">
        <span>Investable <b>{short(a.investable)}</b></span><span>Property <b>{short(a.illiquid)}</b></span><span>Owed <b>{short(a.owed)}</b></span>
        {a.missing.length > 0 && <span className="tag warn">{a.missing.length} missing a value</span>}
      </div>
      {people.length > 1 && (
        <div className="members">
          {people.map((p) => {
            const pa = aggregate(ledger, new Set([p.id]));
            const share = total > 0 ? Math.max(0, pa.nw) / total : 0;
            return (
              <button key={p.id} className="mcard" onClick={() => setScopeId("person:" + p.id)}>
                <span className="who"><Dot color={p.color} /><span>{p.name}</span></span>
                <span className="val num">{short(pa.nw)}</span>
                <span className="bar"><span style={{ width: `${(share * 100).toFixed(1)}%`, background: p.color }} /></span>
                <span className="muted small">{pct(share)} of {scope.label}{pa.missing.length ? ` · ${pa.missing.length} missing` : ""}</span>
              </button>
            );
          })}
        </div>
      )}
      {people.length === 1 && familyScope && (
        <button className="linkish" style={{ justifySelf: "start" }} onClick={() => setScopeId(familyScope.id)}>Back to {familyScope.label}</button>
      )}
    </section>
  );
}
