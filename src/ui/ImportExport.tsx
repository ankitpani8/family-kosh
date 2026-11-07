// Moving people between accounts: export someone as a file or text, and import such a file.
import { useMemo, useState, type ChangeEvent } from "react";
import { buildExport, exportFileName } from "../data/exportPerson";
import { guessMe, importKosh, parseExport, type KoshExport } from "../data/importKosh";
import { useData } from "../data/store";
import { Modal, useToast } from "./components/kit";

/** Pick a file or paste text, then show the import options. */
export function ImportSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [x, setX] = useState<KoshExport | null>(null);
  const [text, setText] = useState("");
  const load = (raw: string) => {
    try { setX(parseExport(raw)); } catch (e) { toast(e instanceof SyntaxError ? "That isn't a Family Kosh export. Check you copied all of it." : e instanceof Error ? e.message : String(e), true); }
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) load(await f.text());
  };
  if (x) return <ImportOptions x={x} onClose={onClose} />;
  return (
    <Modal title="Import people and their money" onClose={onClose}>
      <p className="small">Use a Family Kosh export: a <span className="mono">.json</span> file someone shared with you, or the text they copied from "Share a copy".</p>
      <label className="btn" style={{ justifySelf: "start" }}>Choose a file<input type="file" accept="application/json,.json,text/plain" hidden onChange={onFile} /></label>
      <label className="field">Or paste the text
        <textarea id="import-text" value={text} onChange={(e) => setText(e.target.value)} placeholder='{"members": …' style={{ minHeight: 90, fontFamily: "var(--f-mono)", fontSize: 12 }} />
      </label>
      <div className="actions"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={!text.trim()} onClick={() => load(text)}>Continue</button></div>
    </Modal>
  );
}

function ImportOptions({ x, onClose }: { x: KoshExport; onClose: () => void }) {
  const { remote, selfId, reload } = useData();
  const toast = useToast();
  const members = Object.entries(x.members);
  const myFamilies = remote?.families ?? [];
  const guess = guessMe(x);
  const looksLikeMe = guess && String(x.members[guess]?.relation ?? "").toLowerCase() === "me";
  const [me, setMe] = useState(looksLikeMe ? guess! : "");
  const [target, setTarget] = useState<string>(myFamilies[0]?.id ?? "new");
  const [family, setFamily] = useState("Our family");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!remote || !selfId) return null;
  const run = async () => {
    setBusy(true);
    try {
      const r = await importKosh(x, {
        userId: remote.userId, selfId, meKey: me,
        familyName: target === "new" ? family.trim() || "Our family" : null,
        familyId: target !== "new" && target !== "none" ? target : null,
      }, setMsg);
      await reload();
      toast(`Imported ${r.people} ${r.people === 1 ? "person" : "people"}, ${r.holdings} holdings and ${r.goals} goals`);
      onClose();
    } catch (e) {
      setMsg("");
      toast(e instanceof Error ? e.message : String(e), true);
      await reload();
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Import" onClose={() => !busy && onClose()}>
      <p className="small">This file has {members.map(([, m]) => m.name).join(", ")}: {Object.keys(x.holdings).length} holdings, {Object.keys(x.prices).length} unit prices and {Object.keys(x.goals).length} goals.</p>
      <label className="field">Is one of these people you?
        <select id="import-me" value={me} onChange={(e) => setMe(e.target.value)}>
          <option value="">No, add them as people I manage</option>
          {members.map(([k, m]) => <option key={k} value={k}>Yes, I'm {m.name}</option>)}
        </select>
      </label>
      <p className="muted small">{me ? "Their details become yours; everyone else becomes a person you manage." : "You'll manage them. If they later get their own login, you can hand their profile over."} Run an import once; running it again adds everything again.</p>
      <label className="field">Add them to
        <select id="import-family" value={target} onChange={(e) => setTarget(e.target.value)}>
          {myFamilies.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          <option value="new">A new family…</option>
          <option value="none">No family for now</option>
        </select>
      </label>
      {target === "new" && <label className="field">New family name<input id="import-family-name" value={family} onChange={(e) => setFamily(e.target.value)} /></label>}
      {msg && <div className="note">{msg}</div>}
      <div className="actions"><button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button id="import-run" className="btn" onClick={run} disabled={busy}>{busy ? "Importing…" : "Import"}</button></div>
    </Modal>
  );
}

/** Share a copy of one or more people you manage (or yourself) as a file or as text. */
export function ExportSheet({ personIds, onClose }: { personIds: string[]; onClose: () => void }) {
  const { ledger } = useData();
  const toast = useToast();
  const data = useMemo(() => (ledger ? buildExport(ledger, personIds) : null), [ledger, personIds]);
  if (!ledger || !data) return null;
  const names = personIds.map((id) => ledger.people.find((p) => p.id === id)?.name ?? "");
  const json = JSON.stringify(data);
  const file = exportFileName(names);
  const share = async () => {
    const f = new File([json], file, { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: file }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const copy = () => navigator.clipboard?.writeText(json).then(() => toast("Copied. Paste it into their Import screen."), () => toast("Copy didn't work here. Use Save file instead.", true));
  return (
    <Modal title={`Share a copy of ${names.join(" & ")}`} onClose={onClose}>
      <p className="small">
        Makes a copy of {names.join(" & ")}'s details, {Object.keys(data.holdings).length} holdings and {Object.keys(data.goals).length} goals that someone else can import into their own Family Kosh. It's a snapshot: later changes on either side don't sync.
      </p>
      <div className="note small">
        For a live link instead, {names.length === 1 ? names[0] : "they"} can get their own login: use <b>Hand over</b> on the People screen, then they join the other family with its invite code. One profile, visible in both families, always up to date.
      </div>
      <p className="muted small">This contains personal financial details. Send it only to someone who should see them.</p>
      <div className="actions"><button className="btn ghost" onClick={copy}>Copy as text</button><button className="btn" onClick={share}>Save or send file</button></div>
    </Modal>
  );
}
