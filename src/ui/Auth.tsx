import { useEffect, useState, type FormEvent } from "react";
import { appUrl, isConfigured, supabase } from "../lib/supabase";
import { useData } from "../data/store";

type Mode = "signin" | "signup" | "reset";

export function Auth() {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);

  // Returning from an email link: confirm the account, or explain if the link opened in another browser.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const err = p.get("error_description");
    if (err) setMsg({ text: err, err: true });
    else if (p.get("code")) setMsg({ text: "Email confirmed. Sign in with your password.", err: false });
    if (err || p.get("code")) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, []);

  if (!isConfigured || !supabase) return <NotConfigured />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase!.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      } else if (mode === "signup") {
        if (pw.length < 8) throw new Error("Use a password of at least 8 characters.");
        const { data, error } = await supabase!.auth.signUp({ email, password: pw, options: { data: { display_name: name.trim() }, emailRedirectTo: appUrl() } });
        if (error) throw error;
        if (!data.session) setMsg({ text: `We sent a confirmation link to ${email}. Open it, then sign in here.`, err: false });
      } else {
        const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
        if (error) throw error;
        setMsg({ text: `If ${email} has an account, a reset link is on its way. Open it on this device.`, err: false });
      }
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), err: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth wrap">
      <div className="card">
        <div className="brand"><span className="seal" aria-hidden="true">₹</span>Family Kosh</div>
        <div>
          <h1>{mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset your password"}</h1>
          <p className="muted small">{mode === "signup" ? "Your money stays yours. Join a family group later to share it." : "Your family's money, in one place."}</p>
        </div>
        <form onSubmit={submit}>
          {mode === "signup" && <label className="field">Your name<input id="a-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>}
          <label className="field">Email<input id="a-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" /></label>
          {mode !== "reset" && <label className="field">Password<input id="a-pw" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>}
          {msg && <div className={"note " + (msg.err ? "bad" : "good")}>{msg.text}</div>}
          <button className="btn block" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}</button>
        </form>
        <div className="row small" style={{ justifyContent: "space-between" }}>
          {mode !== "signin" ? <button className="linkish" onClick={() => setMode("signin")}>I have an account</button> : <button className="linkish" onClick={() => setMode("signup")}>Create an account</button>}
          {mode === "signin" && <button className="linkish" onClick={() => setMode("reset")}>Forgot password?</button>}
        </div>
      </div>
    </div>
  );
}

export function SetNewPassword() {
  const { setRecovering } = useData();
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <div className="auth wrap">
      <div className="card">
        <h1>Choose a new password</h1>
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 8) return setMsg("Use at least 8 characters.");
          const { error } = await supabase!.auth.updateUser({ password: pw });
          if (error) setMsg(error.message); else setRecovering(false);
        }}>
          <label className="field">New password<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          {msg && <div className="note bad">{msg}</div>}
          <button className="btn block">Save password</button>
        </form>
      </div>
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="auth wrap">
      <div className="card">
        <div className="brand"><span className="seal" aria-hidden="true">₹</span>Family Kosh</div>
        <h1>Almost there</h1>
        <p className="small">This build doesn't know which database to use yet. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see the README) and rebuild.</p>
      </div>
    </div>
  );
}
