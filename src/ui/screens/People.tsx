import { useState, type FormEvent } from "react";
import { RISK_LABEL, aggregate } from "../../engine";
import * as api from "../../data/api";
import { useData, useMutate } from "../../data/store";
import { inr, short } from "../../lib/format";
import { CopyCode, DeleteButton, Dot, Empty, Modal, useToast } from "../components/kit";
import { useSheet } from "../sheets";

export function People() {
  const { ledger, remote, selfId } = useData();
  const open = useSheet();
  const mutate = useMutate();
  const toast = useToast();
  const [claim, setClaim] = useState<{ name: string; code: string } | null>(null);
  const [invite, setInvite] = useState<{ name: string; code: string } | null>(null);
  const [newFamily, setNewFamily] = useState(false);
  if (!ledger || !remote) return null;
  const me = remote.people.find((p) => p.user_id === remote.userId);
  const adminOf = new Set(remote.members.filter((m) => m.person_id === me?.id && m.role === "admin").map((m) => m.family_id));
  const managed = ledger.people.filter((p) => p.managedByMe);

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    const err = await mutate(fn);
    toast(err ?? okMsg, !!err);
  };
  const makeClaim = async (id: string, name: string) => {
    try { setClaim({ name, code: await api.createClaim(id) }); } catch (e) { toast(e instanceof Error ? e.message : String(e), true); }
  };
  const makeInvite = async (fid: string, name: string) => {
    try { setInvite({ name, code: await api.createInvite(fid) }); } catch (e) { toast(e instanceof Error ? e.message : String(e), true); }
  };

  return (
    <div className="grid">
      <section className="panel span2">
        <div className="panel-h"><h2>People</h2><button className="btn" onClick={() => open({ kind: "person" })}>Add someone you manage</button></div>
        <div className="tbl-wrap">
          <table>
            <thead><tr><th>Name</th><th>Login</th><th>Risk</th><th className="r">Take-home</th><th className="r">Own spending</th><th className="r">Net worth</th><th /></tr></thead>
            <tbody>
              {ledger.people.map((p) => {
                const editable = p.isMe || p.managedByMe;
                return (
                  <tr key={p.id}>
                    <td><Dot color={p.color} /> <b>{p.name}</b><div className="muted small">{p.relation}</div></td>
                    <td className="small">{p.isMe ? "You" : p.hasLogin ? "Own login" : p.managedByMe ? "Managed by you" : "Managed by family"}</td>
                    <td className="small">{RISK_LABEL[p.risk]}</td>
                    <td className="r num">{inr(p.income)}</td>
                    <td className="r num">{p.expenses == null ? <span className="tag warn">not set</span> : inr(p.expenses)}</td>
                    <td className="r num">{short(aggregate(ledger, new Set([p.id])).nw)}</td>
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      {editable && <button className="btn sm ghost" onClick={() => open({ kind: "person", person: p })}>Edit</button>}
                      {p.managedByMe && <> <button className="btn sm ghost" onClick={() => makeClaim(p.id, p.name)}>Hand over</button></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Everyone has their own login and owns their own money. People without a phone or login (like parents) can be managed by you. "Hand over" gives a one-time code that lets them, or a partner with their own login, take over that profile with all its holdings and goals.
        </p>
      </section>

      <section className="panel span2">
        <div className="panel-h"><h2>Families</h2><button className="btn ghost" onClick={() => setNewFamily(true)}>New family</button></div>
        {remote.families.length ? remote.families.map((f) => {
          const members = remote.members.filter((m) => m.family_id === f.id);
          const isAdmin = adminOf.has(f.id);
          const addable = managed.filter((p) => !members.some((m) => m.person_id === p.id));
          return (
            <div key={f.id} style={{ display: "grid", gap: 8, paddingBlock: 8, borderBottom: "1px solid var(--line)" }}>
              <div className="panel-h">
                <h3>{f.name}</h3>
                <div className="row">
                  {isAdmin && <button className="btn sm ghost" onClick={() => makeInvite(f.id, f.name)}>Invite someone</button>}
                  {me && members.some((m) => m.person_id === me.id) && !isAdmin && <button className="btn sm ghost" onClick={() => act(() => api.removeMember(f.id, me.id), "You left " + f.name)}>Leave</button>}
                </div>
              </div>
              <div className="row">
                {members.map((m) => {
                  const p = ledger.people.find((x) => x.id === m.person_id);
                  if (!p) return null;
                  const canRemove = isAdmin ? m.person_id !== me?.id : p.managedByMe;
                  return (
                    <span key={m.person_id} className="tag" style={{ fontSize: 13 }}>
                      <Dot color={p.color} />{p.name}{m.role === "admin" ? " · admin" : ""}
                      {canRemove && <button className="linkish" aria-label={`Remove ${p.name}`} onClick={() => act(() => api.removeMember(f.id, m.person_id), `${p.name} removed`)}>✕</button>}
                    </span>
                  );
                })}
              </div>
              {isAdmin && addable.length > 0 && (
                <div className="row"><span className="muted small">Add:</span>
                  {addable.map((p) => <button key={p.id} className="chip" onClick={() => act(() => api.addMember(f.id, p.id), `${p.name} added`)}><Dot color={p.color} />{p.name}</button>)}
                </div>
              )}
              {isAdmin && <div className="row"><DeleteButton label="Delete family" onDelete={() => act(() => api.deleteFamily(f.id), "Family deleted")} /><span className="muted small">Deleting a family only removes the group; nobody's money is deleted.</span></div>}
            </div>
          );
        }) : <Empty>You're not in a family yet. Create one and invite people, or join one with a code.</Empty>}
        <JoinBox />
      </section>

      {selfId && <ClaimBox />}

      {claim && (
        <Modal title={`Hand over ${claim.name}`} onClose={() => setClaim(null)}>
          <p>Share this code with {claim.name} (or whoever will log in as them). They sign up for Family Kosh, go to People, and enter it under "Take over a profile". Their profile, holdings and goals move to their login and you stop managing them. The code works once and expires in 7 days.</p>
          <CopyCode code={claim.code} />
          <div className="actions"><button className="btn" onClick={() => setClaim(null)}>Done</button></div>
        </Modal>
      )}
      {invite && (
        <Modal title={`Invite to ${invite.name}`} onClose={() => setInvite(null)}>
          <p>Share this code. The person signs up for Family Kosh with their own login, goes to People, and enters it under "Join a family". Joining shares their non-private holdings and goals with the family. The code works for 7 days.</p>
          <CopyCode code={invite.code} />
          <div className="actions"><button className="btn" onClick={() => setInvite(null)}>Done</button></div>
        </Modal>
      )}
      {newFamily && <NewFamily onClose={() => setNewFamily(false)} />}
    </div>
  );
}

function NewFamily({ onClose }: { onClose: () => void }) {
  const { ledger } = useData();
  const mutate = useMutate();
  const toast = useToast();
  const managed = ledger?.people.filter((p) => p.managedByMe) ?? [];
  const [name, setName] = useState("");
  const [add, setAdd] = useState<string[]>(managed.map((p) => p.id));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast("Name the family.", true);
    const err = await mutate(async () => {
      const id = await api.createFamily(name.trim());
      for (const pid of add) await api.addMember(id, pid);
    });
    if (err) toast(err, true);
    else { toast("Family created"); onClose(); }
  };
  return (
    <Modal title="New family" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pani family" /></label>
        {managed.length > 0 && (
          <fieldset><legend>Also add people you manage</legend>
            {managed.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={add.includes(p.id)} onChange={(e) => setAdd(e.target.checked ? [...add, p.id] : add.filter((x) => x !== p.id))} /><Dot color={p.color} />{p.name}</label>)}
          </fieldset>
        )}
        <p className="muted small">You'll be its admin. Invite people with their own login from the family's "Invite someone" button.</p>
        <div className="actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn">Create</button></div>
      </form>
    </Modal>
  );
}

function JoinBox() {
  const mutate = useMutate();
  const toast = useToast();
  const [code, setCode] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    const err = await mutate(() => api.joinFamily(code));
    if (err) toast(err, true);
    else { toast("You've joined the family"); setCode(""); }
  };
  return (
    <form onSubmit={submit} className="row" style={{ alignItems: "end" }}>
      <label className="field" style={{ flex: "1 1 180px" }}>Join a family<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Invite code" autoCapitalize="characters" /></label>
      <button className="btn ghost">Join</button>
    </form>
  );
}

function ClaimBox() {
  const mutate = useMutate();
  const toast = useToast();
  const [code, setCode] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    const err = await mutate(() => api.claimPerson(code));
    if (err) toast(err, true);
    else { toast("Profile taken over. It's yours now."); setCode(""); }
  };
  return (
    <section className="panel span2">
      <h2>Take over a profile</h2>
      <p className="muted small">If someone has been managing your money in Family Kosh, they can give you a hand-over code. Entering it moves that profile, with its holdings and goals, to your login. Anything you've already added yourself is merged in.</p>
      <form onSubmit={submit} className="row" style={{ alignItems: "end" }}>
        <label className="field" style={{ flex: "1 1 180px" }}>Hand-over code<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" /></label>
        <button className="btn ghost">Take over</button>
      </form>
    </section>
  );
}
