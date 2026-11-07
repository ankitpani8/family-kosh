// Date helpers. Dates are plain ISO strings so they compare lexically and survive JSON.

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso(): string {
  return isoDate(new Date());
}

export function lastDayOfMonth(y: number, m: number): string {
  return isoDate(new Date(y, m, 0));
}

/** Whole months from the month containing `today` to the month `ym` (YYYY-MM). */
export function monthsUntil(ym: string, today: string): number {
  if (!ym) return 0;
  const [y, m] = ym.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  return (y - ty) * 12 + (m - tm);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
}

export function addDays(d: string, n: number): string {
  const t = new Date(Date.parse(d + "T00:00:00"));
  t.setDate(t.getDate() + n);
  return isoDate(t);
}

/** YYYY-MM of the month after `today`. */
export function nextMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
