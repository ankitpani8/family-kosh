import { useEffect, useState } from "react";
import { BUCKET_LABEL, LT, RISK_LABEL, type Risk, type Settings as S } from "../../engine";
import { saveSettings } from "../../data/api";
import { useData, useMutate } from "../../data/store";
import { supabase } from "../../lib/supabase";
import { useToast } from "../components/kit";
import { ImportSheet } from "../ImportExport";

export function Settings() {
  const { ledger, remote, session } = useData();
  const mutate = useMutate();
  const toast = useToast();
  const [cfg, setCfg] = useState<S | null>(ledger ? JSON.parse(JSON.stringify(ledger.settings)) : null);
  const [useSignals, setUseSignals] = useState(!!remote?.profile?.settings?.useSignals);
  const [importing, setImporting] = useState(false);
  useEffect(() => { if (ledger && !cfg) setCfg(JSON.parse(JSON.stringify(ledger.settings))); }, [ledger, cfg]);
  if (!ledger || !remote || !cfg || !session) return null;
  const n = (v: string) => (v === "" ? 0 : Number(v));
  const save = async () => {
    const stored = { ...cfg, signalSource: useSignals ? "Signals table" : cfg.signalSource || "Manual", useSignals };
    const err = await mutate(() => saveSettings(remote.userId, stored));
    toast(err ?? "Settings saved", !!err);
  };
  return (
    <div className="grid">
      <section className="panel span2">
        <div className="panel-h"><h2>Planning settings</h2><button className="btn" onClick={save}>Save settings</button></div>
        <div className="controls">
          <label className="field">Emergency fund (months of spending)<input type="number" min={0} max={24} value={cfg.emergencyMonths} onChange={(e) => setCfg({ ...cfg, emergencyMonths: n(e.target.value) })} /></label>
          <label className="field">Inflation (% a year)<input type="number" step={0.5} value={cfg.inflation} onChange={(e) => setCfg({ ...cfg, inflation: n(e.target.value) })} /></label>
          <label className="field">Income growth (% a year)<input type="number" step={0.5} value={cfg.incomeGrowth} onChange={(e) => setCfg({ ...cfg, incomeGrowth: n(e.target.value) })} /></label>
        </div>
        <h3>Target mix by risk profile (%)</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Profile</th>{LT.map((b) => <th key={b}>{BUCKET_LABEL[b]}</th>)}<th>Sum</th></tr></thead>
            <tbody>
              {(Object.keys(RISK_LABEL) as Risk[]).map((k) => (
                <tr key={k}><td>{RISK_LABEL[k]}</td>
                  {LT.map((b) => <td key={b}><input className="num" style={{ width: 64 }} type="number" min={0} max={100} value={cfg.targets[k][b]} onChange={(e) => setCfg({ ...cfg, targets: { ...cfg.targets, [k]: { ...cfg.targets[k], [b]: n(e.target.value) } } })} /></td>)}
                  <td className="num small">{LT.reduce((t, b) => t + (cfg.targets[k][b] || 0), 0)}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Returns, risk and signal tilts</h3>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Asset type</th><th>Return %/yr</th><th>Volatility %</th><th>Tilt (pts)</th></tr></thead>
            <tbody>
              {LT.map((b) => (
                <tr key={b}><td>{BUCKET_LABEL[b]}</td>
                  <td><input style={{ width: 70 }} type="number" step={0.1} value={cfg.assumptions[b].ret} onChange={(e) => setCfg({ ...cfg, assumptions: { ...cfg.assumptions, [b]: { ...cfg.assumptions[b], ret: n(e.target.value) } } })} /></td>
                  <td><input style={{ width: 70 }} type="number" step={0.5} value={cfg.assumptions[b].vol} onChange={(e) => setCfg({ ...cfg, assumptions: { ...cfg.assumptions, [b]: { ...cfg.assumptions[b], vol: Math.max(0, n(e.target.value)) } } })} /></td>
                  <td><input style={{ width: 70 }} type="number" step={1} value={cfg.views[b]} disabled={useSignals} onChange={(e) => setCfg({ ...cfg, views: { ...cfg.views, [b]: n(e.target.value) } })} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="check"><input type="checkbox" checked={useSignals} onChange={(e) => setUseSignals(e.target.checked)} /> Take tilts from the latest signal (for example InvestBot){remote.signal ? ` · latest: ${remote.signal.source}, ${remote.signal.as_of}` : " · none received yet"}</label>
        <p className="muted small">Targets that don't sum to 100 are scaled to fit. A tilt of +5 adds five points to that asset type's target for every profile.</p>
      </section>

      <section className="panel">
        <h2>Account</h2>
        <p className="small">Signed in as <b>{session.user.email}</b></p>
        <ChangePassword />
        <button className="btn ghost" style={{ justifySelf: "start" }} onClick={() => supabase?.auth.signOut()}>Sign out</button>
      </section>

      <section className="panel">
        <h2>Install the app</h2>
        <Install />
      </section>

      <section className="panel span2">
        <h2>Import</h2>
        <p className="muted small">Bring in people, holdings with their history, unit prices and goals from a Family Kosh export: your old artifact file, or a copy someone shared from their People screen. Run each import once; running it twice adds everything twice.</p>
        <button id="open-import" className="btn ghost" style={{ justifySelf: "start" }} onClick={() => setImporting(true)}>Import a file or text</button>
      </section>
      {importing && <ImportSheet onClose={() => setImporting(false)} />}
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [pw, setPw] = useState("");
  return (
    <form className="row" style={{ alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault();
      if (pw.length < 8) return toast("Use at least 8 characters.", true);
      const { error } = await supabase!.auth.updateUser({ password: pw });
      toast(error ? error.message : "Password changed", !!error);
      if (!error) setPw("");
    }}>
      <label className="field" style={{ flex: "1 1 160px" }}>New password<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <button className="btn ghost">Change</button>
    </form>
  );
}

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIP | null = null;
if (typeof window !== "undefined") window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BIP; });

function Install() {
  const [ready, setReady] = useState(!!deferred);
  useEffect(() => {
    const h = () => setReady(true);
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone;
  if (standalone) return <p className="small">You're using the installed app.</p>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {ready && <button className="btn" style={{ justifySelf: "start" }} onClick={async () => { await deferred?.prompt(); deferred = null; setReady(false); }}>Install Family Kosh</button>}
      <p className="small"><b>Android (Chrome):</b> menu ⋮ → Install app. Or install the APK from the GitHub Releases page.</p>
      <p className="small"><b>iPhone (Safari):</b> Share → Add to Home Screen.</p>
      <p className="small"><b>Desktop (Chrome/Edge):</b> the install icon in the address bar.</p>
    </div>
  );
}
