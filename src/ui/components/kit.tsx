import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Bucket } from "../../engine";

export const bcolor = (b: Bucket | string) => `var(--b-${b})`;

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="dot" style={{ background: color, width: size, height: size }} />;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** A delete button that needs a second tap, since the app can't use confirm(). */
export function DeleteButton({ onDelete, label = "Delete" }: { onDelete: () => void; label?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className="btn danger" onClick={() => (armed ? onDelete() : setArmed(true))} onBlur={() => setArmed(false)}>
      {armed ? "Tap again to delete" : label}
    </button>
  );
}

const ToastCtx = createContext<(msg: string, err?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; err: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((msg: string, err = false) => {
    setT({ msg, err });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), err ? 5000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div role="status" aria-live="polite">{t && <div className={"toast" + (t.err ? " err" : "")}>{t.msg}</div>}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function CopyCode({ code }: { code: string }) {
  const toast = useToast();
  return (
    <div className="row">
      <span className="code">{code}</span>
      <button type="button" className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(code).then(() => toast("Copied"), () => toast("Select the code to copy it"))}>
        Copy
      </button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
