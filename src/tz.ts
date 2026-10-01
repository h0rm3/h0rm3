/** Every bucket, streak, and window in this project uses this zone. */
export const TZ = "America/New_York";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(input: Date | string | number, timeZone = TZ): ZonedParts {
  const d = input instanceof Date ? input : new Date(input);
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(d)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD of the instant in the given zone (New York by default). */
export function dateKey(input: Date | string | number, timeZone = TZ): string {
  const p = zonedParts(input, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function hourOf(input: Date | string | number, timeZone = TZ): number {
  return zonedParts(input, timeZone).hour;
}

/** Pure calendar arithmetic on YYYY-MM-DD keys (no zone involved). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday, for a calendar date key. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The UTC instant at which the given wall-clock time occurs in the zone. */
export function zonedTimeToUtc(key: string, hour = 0, timeZone = TZ): Date {
  const [y, m, d] = key.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d, hour);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(t, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    t -= asUtc - Date.UTC(y, m - 1, d, hour);
  }
  return new Date(t);
}

/** Keys for the `n` calendar days ending at `endKey`, oldest first. */
export function lastNDays(endKey: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(endKey, i - (n - 1)));
}
