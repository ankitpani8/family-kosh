// Indian number formatting: lakh and crore grouping, ₹ prefix.

export function inr(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return (n < 0 ? "−" : "") + "₹" + Math.round(Math.abs(n)).toLocaleString("en-IN");
}

export function short(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e9 ? 0 : a >= 1e8 ? 1 : 2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)} L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${s}₹${Math.round(a)}`;
}

export function pct(x: number | null | undefined, digits = 0): string {
  if (x == null || !isFinite(x)) return "—";
  return (x * 100).toFixed(digits) + "%";
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtMonth(ym: string | null | undefined): string {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, dd] = d.split("-").map(Number);
  return `${dd} ${MONTHS[m - 1]} ${y}`;
}

/** Parse a user-typed number, allowing commas. Empty → null. */
export function num(v: string | number | null | undefined): number | null {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return isFinite(n) ? n : null;
}
