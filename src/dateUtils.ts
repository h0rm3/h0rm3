function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local-timezone YYYY-MM-DD key for a timestamp or Date. */
export function localDateKey(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Inverse of localDateKey: a Date at local midnight for that calendar day. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Whole-day difference between two local-midnight Dates, DST-safe via rounding. */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}
