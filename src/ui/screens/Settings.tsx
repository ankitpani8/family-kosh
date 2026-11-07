import { useEffect, useState, type ChangeEvent } from "react";
import { BUCKET_LABEL, LT, RISK_LABEL, type Risk, type Settings as S } from "../../engine";
import { saveSettings } from "../../data/api";
import { guessMe, importKosh, parseExport, type KoshExport } from "../../data/importKosh";
import { useData, useMutate } from "../../data/store";
import { supabase } from "../../lib/supabase";
import { Modal, useToast } from "../components/kit";

export function Settings() {
  const { ledger, remote, session } = useData();
  const mutate = useMutate();
  const toast = useToast();
  const [cfg, setCfg] = useState<S | null>(ledger ? JSON.parse(JSON.stringify(ledger.settings)) : null);
  const [useSignals, setUseSignals] = useState(!!remote?.profile?.settings?.useSignals);
  const [importing, setImporting] = useState<KoshExport | null>(null);
  useEffect(() => { if (ledger && !cfg) setCfg(JSON.parse(JSON.stringify(ledger.settings))); }, [ledger, cfg]);
  if (!ledger || !remote || !cfg || !session) return null;
  const n = (v: string) => (v === "" ? 0 : Number(v));
  const save = async () => {
    const stored = { ...cfg, signalSource: useSignals ? "Signals table" : cfg.signalSource || "Manual", useSignals };
    const err = await mutate(() => saveSettings(remote.userId, stored));
    toast(err ?? "Settings saved", !!err);
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { setImporting(parseExport(await file.text())); } catch (err) { toast(err instanceof Error ? err.message : "That file isn't a Family Kosh export.", true); }
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
        <h2>Import from the Family Kosh artifact</h2>
        <p className="muted small">Brings in people, holdings with their history, unit prices and goals from a Family Kosh export file. Run it once on a fresh account; running it twice adds everything twice.</p>
        <label className="btn ghost" style={{ justifySelf: "start" }}>Choose export file<input type="file" accept="application/json,.json" hidden onChange={onFile} /></label>
      </section>
      {importing && <ImportSheet x={importing} onClose={() => setImporting(null)} />}
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

function ImportSheet({ x, onClose }: { x: KoshExport; onClose: () => void }) {
  const { remote, selfId, reload } = useData();
  const toast = useToast();
  const [me, setMe] = useState(guessMe(x) ?? "");
  const [family, setFamily] = useState("Our family");
  const [makeFamily, setMakeFamily] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!remote || !selfId) return null;
  const run = async () => {
    setBusy(true);
    try {
      const r = await importKosh(x, { userId: remote.userId, selfId, meKey: me, familyName: makeFamily ? family.trim() || "Our family" : null }, setMsg);
      await reload();
      toast(`Imported ${r.people} people, ${r.holdings} holdings and ${r.goals} goals`);
      onClose();
    } catch (e) {
      setMsg(""); toast(e instanceof Error ? e.message : String(e), true);
      await reload();
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Import" onClose={() => !busy && onClose()}>
      <p className="small">Found {Object.keys(x.members).length} people, {Object.keys(x.holdings).length} holdings, {Object.keys(x.prices).length} unit prices and {Object.keys(x.goals).length} goals.</p>
      <label className="field">Which person is you?
        <select value={me} onChange={(e) => setMe(e.target.value)}>{Object.entries(x.members).map(([k, m]) => <option key={k} value={k}>{m.name}</option>)}</select>
      </label>
      <p className="muted small">Everyone else becomes a person you manage. Anyone with their own login can take over their profile later with a hand-over code.</p>
      <label className="check"><input type="checkbox" checked={makeFamily} onChange={(e) => setMakeFamily(e.target.checked)} /> Put everyone in a family</label>
      {makeFamily && <label className="field">Family name<input value={family} onChange={(e) => setFamily(e.target.value)} /></label>}
      {msg && <div className="note">{msg}</div>}
      <div className="actions"><button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn" onClick={run} disabled={busy || !me}>{busy ? "Importing…" : "Import"}</button></div>
    </Modal>
  );
}
