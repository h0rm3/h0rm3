import type { AiBlock, CommitRecord, History, LanguageTotals, Row, Source, Stats, Totals } from "./types.js";
import { addDays, dateKey, dayDiff, hourOf, weekdayOfKey } from "./tz.js";

export const TIME_BUCKET_ORDER = ["Morning", "Daytime", "Evening", "Night"] as const;
export const TIME_BUCKET_EMOJI: Record<string, string> = { Morning: "🌞", Daytime: "🌆", Evening: "🌃", Night: "🌙" };
export const WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** Morning 05-11, Daytime 12-16, Evening 17-20, Night 21-04 (wraps midnight). */
export function timeBucketOfHour(h: number): string {
  if (h >= 5 && h <= 11) return "Morning";
  if (h >= 12 && h <= 16) return "Daytime";
  if (h >= 17 && h <= 20) return "Evening";
  return "Night";
}

/** Monday-first weekday name for a calendar date key. */
export function weekdayName(key: string): string {
  return WEEKDAY_ORDER[(weekdayOfKey(key) + 6) % 7];
}

export function article(word: string): "a" | "an" {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

export function blockBar(value: number, max: number, width = 25): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** One-decimal percentages via largest remainder, so displayed values sum to exactly 100.0. */
export function percentRows(items: { label: string; value: number }[]): Row[] {
  const total = items.reduce((a, i) => a + i.value, 0);
  if (total === 0) return items.map((i) => ({ ...i, percent: 0 }));
  const raw = items.map((i) => (i.value / total) * 1000);
  const floors = raw.map(Math.floor);
  let remaining = 1000 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, idx) => ({ idx, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  for (const { idx } of order) {
    if (remaining <= 0) break;
    floors[idx]++;
    remaining--;
  }
  return items.map((i, idx) => ({ label: i.label, value: i.value, percent: floors[idx] / 10 }));
}

export function computeStreaks(commitDays: Record<string, number>, todayKey: string): Stats["streak"] {
  const totalCommits = Object.values(commitDays).reduce((a, b) => a + b, 0);
  const active = Object.keys(commitDays).filter((k) => commitDays[k] > 0).sort();
  if (active.length === 0) return { totalCommits, currentStreak: 0, longestStreak: 0 };

  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < active.length; i++) {
    run = dayDiff(active[i], active[i - 1]) === 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  }

  let currentStreak = 0;
  // Today may not have a commit yet; the streak stays alive if the latest active day is today or yesterday.
  if (dayDiff(todayKey, active[active.length - 1]) <= 1) {
    currentStreak = 1;
    for (let i = active.length - 2; i >= 0 && dayDiff(active[i + 1], active[i]) === 1; i--) currentStreak++;
  }
  return { totalCommits, currentStreak, longestStreak };
}

export function series(days: string[], counts: Record<string, number>): { date: string; count: number }[] {
  return days.map((date) => ({ date, count: counts[date] ?? 0 }));
}

function addTotals(acc: Totals, t: Totals): void {
  acc.freshInput += t.freshInput;
  acc.cacheWrite += t.cacheWrite;
  acc.cacheRead += t.cacheRead;
  acc.output += t.output;
  acc.sessions += t.sessions;
  acc.prompts += t.prompts;
}

const tokensOf = (t: Totals) => t.freshInput + t.cacheWrite + t.cacheRead + t.output;

/** Sums one source over the given day keys (or all days when `days` is null). */
export function aiBlock(history: History, source: Source, days: string[] | null): AiBlock {
  const keys = days ?? Object.keys(history.days);
  const all: Totals = { freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0, sessions: 0, prompts: 0 };
  const fams = new Map<string, Totals>();
  for (const k of keys) {
    const sd = history.days[k]?.[source];
    if (!sd) continue;
    addTotals(all, sd.all);
    for (const [f, t] of Object.entries(sd.families)) {
      const acc = fams.get(f) ?? { freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0, sessions: 0, prompts: 0 };
      addTotals(acc, t);
      fams.set(f, acc);
    }
  }
  const famItems = [...fams.entries()]
    .map(([label, t]) => ({ label, value: tokensOf(t) }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return {
    freshInput: all.freshInput,
    cacheWrite: all.cacheWrite,
    cacheRead: all.cacheRead,
    output: all.output,
    totalInput: all.freshInput + all.cacheWrite + all.cacheRead,
    sessions: all.sessions,
    prompts: all.prompts,
    families: percentRows(famItems),
  };
}

export function claudeAllTimeExtras(history: History): Omit<Stats["claudeAllTime"], keyof AiBlock> {
  const keys = Object.keys(history.days).filter((k) => history.days[k]["claude-code"]).sort();
  let sessions = 0;
  let prompts = 0;
  let longest = 0;
  const byHour = Array(24).fill(0);
  for (const k of keys) {
    const a = history.days[k]["claude-code"]!.all;
    sessions += a.sessions;
    prompts += a.prompts;
    longest = Math.max(longest, a.longestSessionMinutes);
    a.promptsByHour.forEach((n, h) => (byHour[h] += n));
  }
  const maxHourCount = Math.max(...byHour);
  return {
    avgPromptsPerSession: sessions > 0 ? Math.round((prompts / sessions) * 10) / 10 : null,
    longestSessionMinutes: sessions > 0 ? longest : null,
    mostActiveHour: maxHourCount > 0 ? byHour.indexOf(maxHourCount) : null,
    firstDay: keys[0] ?? null,
  };
}

export function topTools(history: History, n = 8): Stats["topTools"] {
  const counts = new Map<string, number>();
  for (const d of Object.values(history.days)) {
    for (const [name, c] of Object.entries(d["claude-code"]?.all.tools ?? {})) counts.set(name, (counts.get(name) ?? 0) + c);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, n).map(([label, value]) => ({ label, value }));
  const rest = sorted.slice(n);
  if (rest.length > 0) top.push({ label: `Other (${rest.length} tools)`, value: rest.reduce((a, [, c]) => a + c, 0) });
  return { totalCalls: sorted.reduce((a, [, c]) => a + c, 0), rows: percentRows(top) };
}

/** Prompts per New York day across both sources. */
export function promptsByDay(history: History): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, d] of Object.entries(history.days)) {
    const n = (d["claude-code"]?.all.prompts ?? 0) + (d.codex?.all.prompts ?? 0);
    if (n > 0) out[k] = n;
  }
  return out;
}

/** Commits (exact timestamps) + AI prompts (history, by New York hour), bucketed in New York time. */
export function builderProfile(commits: CommitRecord[], history: History): Stats["builderProfile"] {
  const buckets = new Map<string, number>(TIME_BUCKET_ORDER.map((b) => [b, 0]));
  const weekdays = new Map<string, number>(WEEKDAY_ORDER.map((w) => [w, 0]));
  const add = (key: string, hour: number, n: number) => {
    const b = timeBucketOfHour(hour);
    buckets.set(b, buckets.get(b)! + n);
    const w = weekdayName(key);
    weekdays.set(w, weekdays.get(w)! + n);
  };

  for (const c of commits) add(dateKey(c.timestamp), hourOf(c.timestamp), 1);
  let promptEvents = 0;
  for (const [k, d] of Object.entries(history.days)) {
    for (const src of ["claude-code", "codex"] as Source[]) {
      d[src]?.all.promptsByHour.forEach((n, h) => {
        if (n > 0) {
          add(k, h, n);
          promptEvents += n;
        }
      });
    }
  }

  const timeRows = percentRows(TIME_BUCKET_ORDER.map((label) => ({ label, value: buckets.get(label)! })));
  const dayRows = percentRows(WEEKDAY_ORDER.map((label) => ({ label, value: weekdays.get(label)! })));
  const total = commits.length + promptEvents;
  let headline = "Not enough data yet to say what kind of builder I am.";
  if (total > 0) {
    const top = timeRows.reduce((m, r) => (r.value > m.value ? r : m));
    const day = dayRows.reduce((m, r) => (r.value > m.value ? r : m));
    headline = `I'm ${article(top.label)} ${top.label} builder, most active on ${day.label}`;
  }
  return { timeBuckets: timeRows, weekdays: dayRows, headline, commitEvents: commits.length, promptEvents };
}

/** Languages under the threshold are grouped into "Other". */
export function languageRows(totals: LanguageTotals, thresholdPercent = 1): Row[] {
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kept = sorted.filter(([, b]) => (b / total) * 100 >= thresholdPercent).map(([label, value]) => ({ label, value }));
  const otherBytes = sorted.filter(([, b]) => (b / total) * 100 < thresholdPercent).reduce((a, [, b]) => a + b, 0);
  if (otherBytes > 0) kept.push({ label: "Other", value: otherBytes });
  return percentRows(kept);
}

export function weekDays(todayKey: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(todayKey, i - 6));
}
