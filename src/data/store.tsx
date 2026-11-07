// App-wide data: the signed-in session, everything it can see, the chosen view, and live updates.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { supabase } from "../lib/supabase";
import { todayIso, type Ledger } from "../engine";
import { loadRemote } from "./api";
import { scopeOptions, toLedger, type Remote, type ScopeOption } from "./model";

interface DataState {
  session: Session | null;
  authReady: boolean;
  recovering: boolean;
  setRecovering: (v: boolean) => void;
  remote: Remote | null;
  ledger: Ledger | null;
  loading: boolean;
  offline: boolean;
  error: string | null;
  reload: () => Promise<void>;
  scopes: ScopeOption[];
  scope: ScopeOption | null;
  setScopeId: (id: string) => void;
  selfId: string | null;
}

const Ctx = createContext<DataState | null>(null);

const cacheKey = (uid: string) => `kosh:remote:${uid}`;
const scopeKey = "kosh:scope";

export function DataProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [error, setError] = useState<string | null>(null);
  const [scopeId, setScopeIdState] = useState<string>(() => {
    try { return localStorage.getItem(scopeKey) ?? ""; } catch { return ""; }
  });
  const uid = session?.user.id ?? null;

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event === "SIGNED_OUT") setRemote(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const inflight = useRef<Promise<void> | null>(null);
  const reload = useCallback(async () => {
    if (!uid) return;
    if (inflight.current) return inflight.current;
    const run = (async () => {
      setLoading(true);
      try {
        const r = await loadRemote(uid);
        setRemote(r);
        setError(null);
        setOffline(false);
        idbSet(cacheKey(uid), r).catch(() => {});
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!navigator.onLine || /fetch|network/i.test(msg)) setOffline(true);
        else setError(msg);
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [uid]);

  // Show the cached copy instantly, then refresh from the server.
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    idbGet<Remote>(cacheKey(uid)).then((cached) => { if (alive && cached && cached.userId === uid) setRemote((r) => r ?? cached); }).catch(() => {});
    reload();
    return () => { alive = false; };
  }, [uid, reload]);

  // Live updates: any change anyone makes that this account can see triggers a quiet refresh.
  useEffect(() => {
    if (!supabase || !uid) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const bump = () => { clearTimeout(t); t = setTimeout(() => reload(), 600); };
    const ch = supabase.channel("kosh-live");
    for (const table of ["people", "families", "family_members", "holdings", "holding_owners", "holding_snapshots", "price_series", "price_points", "goals", "goal_links"])
      ch.on("postgres_changes", { event: "*", schema: "public", table }, bump);
    ch.subscribe();
    const vis = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearTimeout(t); supabase!.removeChannel(ch); document.removeEventListener("visibilitychange", vis); };
  }, [uid, reload]);

  const ledger = useMemo(() => (remote ? toLedger(remote, todayIso()) : null), [remote]);
  const scopes = useMemo(() => (remote && ledger ? scopeOptions(remote, ledger) : []), [remote, ledger]);
  const scope = scopes.find((s) => s.id === scopeId) ?? scopes[0] ?? null;
  const selfId = ledger?.people.find((p) => p.isMe)?.id ?? null;
  const setScopeId = (id: string) => {
    setScopeIdState(id);
    try { localStorage.setItem(scopeKey, id); } catch { /* private mode */ }
  };

  return (
    <Ctx.Provider value={{ session, authReady, recovering, setRecovering, remote, ledger, loading, offline, error, reload, scopes, scope, setScopeId, selfId }}>
      {children}
    </Ctx.Provider>
  );
}

export function useData(): DataState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData outside DataProvider");
  return v;
}

/** Run a write, then refresh. Returns an error message or null. */
export function useMutate() {
  const { reload, offline } = useData();
  return useCallback(
    async (fn: () => Promise<unknown>): Promise<string | null> => {
      if (offline || !navigator.onLine) return "You're offline. Changes need a connection; your data is still shown from the last sync.";
      try {
        await fn();
        await reload();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [reload, offline],
  );
}
