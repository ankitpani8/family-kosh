// First-run checklist: walks a new account from an empty ledger to a working family page.
import { useState } from "react";
import { editablePeople } from "../data/model";
import { useData } from "../data/store";
import { useSheet } from "./sheets";
import { ImportSheet } from "./ImportExport";
import { JoinBox, NewFamily } from "./screens/People";

const key = (uid: string) => `kosh:getstarted:hidden:${uid}`;

export function GetStarted({ go }: { go: (tab: string) => void }) {
  const { ledger, remote, selfId } = useData();
  const open = useSheet();
  const [hidden, setHidden] = useState(() => { try { return !!remote && localStorage.getItem(key(remote.userId)) === "1"; } catch { return false; } });
  const [sheet, setSheet] = useState<"family" | "import" | null>(null);
  if (!ledger || !remote || !selfId) return null;
  const me = ledger.people.find((p) => p.id === selfId)!;
  const mine = editablePeople(remote);
  const inFamily = remote.members.some((m) => m.person_id === selfId);
  const managed = ledger.people.filter((p) => p.managedByMe);
  const owns = ledger.holdings.some((h) => h.owners.some((o) => mine.has(o.personId)));
  const myFamilyIds = remote.members.filter((m) => m.person_id === selfId).map((m) => m.family_id);
  const othersWithLogin = remote.members.some((m) => myFamilyIds.includes(m.family_id) && ledger.people.find((p) => p.id === m.person_id && p.hasLogin && !p.isMe));
  const steps = [
    { done: me.income > 0 && me.expenses != null, title: "Add your details", body: "Your name, take-home pay and monthly spending. These drive next month's plan.", action: <button className="btn sm" onClick={() => open({ kind: "person", person: me })}>Add details</button> },
    { done: inFamily, title: "Create your family", body: "A family is a private group whose net worth you see together. You'll be its admin. Joining someone else's family instead? Use their invite code below.", action: <button className="btn sm" onClick={() => setSheet("family")}>Create family</button> },
    { done: managed.length > 0, optional: true, title: "Add people you look after", body: "For anyone who won't log in themselves, like parents. You'll manage their money; they can take it over later.", action: <button className="btn sm ghost" onClick={() => open({ kind: "person" })}>Add a person</button> },
    { done: owns, title: "Add what you own", body: "Bank accounts, funds, FDs, PPF/EPF, gold, property, loans. Or import a file someone shared with you.", action: <span className="row"><button className="btn sm" onClick={() => open({ kind: "holding" })}>Add a holding</button><button className="btn sm ghost" onClick={() => setSheet("import")}>Import a file</button></span> },
    { done: othersWithLogin, optional: true, title: "Invite family members with their own login", body: "They sign up, then enter your family's invite code. Their money stays theirs; the family sees it together.", action: <button className="btn sm ghost" onClick={() => go("people")}>Get an invite code</button> },
  ];
  const required = steps.filter((s) => !s.optional);
  const allDone = required.every((s) => s.done);
  if (hidden || (allDone && steps.every((s) => s.done))) return null;
  const doneCount = steps.filter((s) => s.done).length;
  const hide = () => { try { localStorage.setItem(key(remote.userId), "1"); } catch { /* ignore */ } setHidden(true); };
  return (
    <section className="panel span2" id="get-started" aria-label="Get started">
      <div className="panel-h">
        <div><h2>{allDone ? "You're set up" : "Set up your Family Kosh"}</h2><p className="muted small">{doneCount} of {steps.length} done · {inFamily ? "your family sees your holdings unless you mark them private" : "only you can see your money until you join a family"}</p></div>
        <button className="linkish" onClick={hide}>{allDone ? "Hide" : "Hide for now"}</button>
      </div>
      <div className="progress"><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={i} className={s.done ? "done" : ""}>
            <span className="num-badge" aria-hidden="true">{s.done ? "✓" : i + 1}</span>
            <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
              <div><b>{s.title}</b>{s.optional && <span className="tag" style={{ marginLeft: 6 }}>optional</span>}</div>
              {!s.done && <p className="muted small">{s.body}</p>}
              {!s.done && s.action}
              {!s.done && i === 1 && <JoinBox />}
            </div>
          </li>
        ))}
      </ol>
      {sheet === "family" && <NewFamily onClose={() => setSheet(null)} />}
      {sheet === "import" && <ImportSheet onClose={() => setSheet(null)} />}
    </section>
  );
}
