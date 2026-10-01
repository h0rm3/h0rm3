import type { AiPrompt, AiTurn, CommitRecord, LanguageTotals, Stats, TimeBucketStats, WeekdayStats } from "./types.js";
import { localDateKey } from "./dateUtils.js";

export const TIME_BUCKET_ORDER = ["Morning", "Daytime", "Evening", "Night"] as const;
export const TIME_BUCKET_EMOJI: Record<string, string> = {
  Morning: "🌞",
  Daytime: "🌆",
  Evening: "🌃",
  Night: "🌙",
};
export const WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function timeBucket(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h <= 11) return "Morning";
  if (h >= 12 && h <= 16) return "Daytime";
  if (h >= 17 && h <= 20) return "Evening";
  return "Night"; // 21:00-23:59 and 00:00-04:59
}

export function weekdayName(date: Date): string {
  // JS getDay(): 0=Sunday..6=Saturday; rotate so Monday is first.
  return WEEKDAY_ORDER[(date.getDay() + 6) % 7];
}

export function article(word: string): "a" | "an" {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

export function blockBar(value: number, max: number, width = 25): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sum<T>(items: T[], f: (item: T) => number): number {
  return items.reduce((acc, item) => acc + f(item), 0);
}

function countBy(dates: Date[], keyFn: (d: Date) => string, order: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>(order.map((k) => [k, 0]));
  for (const d of dates) {
    const k = keyFn(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function computeTimeBuckets(dates: Date[]): TimeBucketStats[] {
  const counts = countBy(dates, timeBucket, TIME_BUCKET_ORDER);
  const total = dates.length;
  const max = Math.max(0, ...counts.values());
  return TIME_BUCKET_ORDER.map((bucket) => {
    const count = counts.get(bucket)!;
    return { bucket, count, percent: total > 0 ? round1((count / total) * 100) : 0, bar: blockBar(count, max) };
  });
}

export function computeWeekdays(dates: Date[]): WeekdayStats[] {
  const counts = countBy(dates, weekdayName, WEEKDAY_ORDER);
  const total = dates.length;
  const max = Math.max(0, ...counts.values());
  return WEEKDAY_ORDER.map((weekday) => {
    const count = counts.get(weekday)!;
    return { weekday, count, percent: total > 0 ? round1((count / total) * 100) : 0, bar: blockBar(count, max) };
  });
}

export function computeBuilderProfile(commits: CommitRecord[], prompts: AiPrompt[]): Stats["builderProfile"] {
  const dates = [...commits.map((c) => new Date(c.timestamp)), ...prompts.map((p) => new Date(p.timestamp))];
  const timeBuckets = computeTimeBuckets(dates);
  const weekdays = computeWeekdays(dates);

  if (dates.length === 0) {
    return { timeBuckets, weekdays, headline: "Not enough data yet to say what kind of builder I am." };
  }

  const topBucket = timeBuckets.reduce((max, b) => (b.count > max.count ? b : max), timeBuckets[0]);
  const topWeekday = weekdays.reduce((max, w) => (w.count > max.count ? w : max), weekdays[0]);
  const headline = `I'm ${article(topBucket.bucket)} ${topBucket.bucket} builder, most active on ${topWeekday.weekday}`;

  return { timeBuckets, weekdays, headline };
}

export function computeLanguagePercents(totals: LanguageTotals, otherThresholdPercent = 3): Stats["languages"] {
  const totalBytes = sum(Object.values(totals), (b) => b);
  if (totalBytes === 0) return [];

  const entries = Object.entries(totals)
    .map(([name, bytes]) => ({ name, bytes, percent: (bytes / totalBytes) * 100 }))
    .sort((a, b) => b.bytes - a.bytes);

  const kept = entries.filter((e) => e.percent >= otherThresholdPercent);
  const rest = entries.filter((e) => e.percent < otherThresholdPercent);

  const result = kept.map((e) => ({ name: e.name, bytes: e.bytes, percent: round1(e.percent) }));
  if (rest.length > 0) {
    const otherBytes = sum(rest, (e) => e.bytes);
    result.push({ name: "Other", bytes: otherBytes, percent: round1((otherBytes / totalBytes) * 100) });
  }
  return result;
}

export function computeStreaks(
  dailyCounts: Map<string, number>,
  today: Date = new Date(),
): Stats["streak"] {
  const totalCommits = sum([...dailyCounts.values()], (v) => v);
  const activeDays = [...dailyCounts.entries()]
    .filter(([, count]) => count > 0)
    .map(([key]) => key)
    .sort();

  if (activeDays.length === 0) return { totalCommits: 0, currentStreak: 0, longestStreak: 0 };

  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < activeDays.length; i++) {
    const diff = dayDiffKeys(activeDays[i], activeDays[i - 1]);
    run = diff === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }

  const todayKey = localDateKey(today);
  const mostRecent = activeDays[activeDays.length - 1];
  const gapFromToday = dayDiffKeys(todayKey, mostRecent);

  let currentStreak = 0;
  if (gapFromToday <= 1) {
    currentStreak = 1;
    for (let i = activeDays.length - 2; i >= 0; i--) {
      if (dayDiffKeys(activeDays[i + 1], activeDays[i]) === 1) currentStreak++;
      else break;
    }
  }

  return { totalCommits, currentStreak, longestStreak };
}

function dayDiffKeys(aKey: string, bKey: string): number {
  const [ay, am, ad] = aKey.split("-").map(Number);
  const [by, bm, bd] = bKey.split("-").map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function computeCommitsPerDay(
  dailyCounts: Map<string, number>,
  now: Date = new Date(),
  days = 90,
): Stats["commitsPerDay"] {
  const result: Stats["commitsPerDay"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = localDateKey(d);
    result.push({ date: key, count: dailyCounts.get(key) ?? 0 });
  }
  return result;
}

export function computeAiWeek(turns: AiTurn[], prompts: AiPrompt[], now: Date = new Date()): Stats["aiWeek"] {
  const weekAgoMs = now.getTime() - 7 * 86_400_000;
  const inWeek = (ts: string) => {
    const t = new Date(ts).getTime();
    return t >= weekAgoMs && t <= now.getTime();
  };

  const weekTurns = turns.filter((t) => inWeek(t.timestamp));
  const weekPrompts = prompts.filter((p) => inWeek(p.timestamp));

  const freshInputTokens = sum(weekTurns, (t) => t.freshInputTokens);
  const cacheCreationTokens = sum(weekTurns, (t) => t.cacheCreationTokens);
  const cacheReadTokens = sum(weekTurns, (t) => t.cacheReadTokens);
  const outputTokens = sum(weekTurns, (t) => t.outputTokens);
  const totalInputTokens = freshInputTokens + cacheCreationTokens + cacheReadTokens;
  const totalTokens = totalInputTokens + outputTokens;

  const sessions = new Set([...weekTurns.map((t) => t.sessionId), ...weekPrompts.map((p) => p.sessionId)]).size;

  const byFamily = new Map<string, number>();
  for (const t of weekTurns) {
    const tokens = t.freshInputTokens + t.cacheCreationTokens + t.cacheReadTokens + t.outputTokens;
    byFamily.set(t.family, (byFamily.get(t.family) ?? 0) + tokens);
  }
  const maxFamily = Math.max(0, ...byFamily.values());
  const families = [...byFamily.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([family, tokens]) => ({
      family,
      tokens,
      bar: blockBar(tokens, maxFamily),
      percent: totalTokens > 0 ? round1((tokens / totalTokens) * 100) : 0,
    }));

  return {
    freshInputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    totalInputTokens,
    totalTokens,
    sessions,
    prompts: weekPrompts.length,
    families,
  };
}

export function buildStats(input: {
  turns: AiTurn[];
  prompts: AiPrompt[];
  commits: CommitRecord[];
  languages: LanguageTotals;
  dailyCommitCounts: Map<string, number>;
  now?: Date;
}): Stats {
  const now = input.now ?? new Date();
  return {
    generatedAt: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    aiWeek: computeAiWeek(input.turns, input.prompts, now),
    builderProfile: computeBuilderProfile(input.commits, input.prompts),
    languages: computeLanguagePercents(input.languages),
    streak: computeStreaks(input.dailyCommitCounts, now),
    commitsPerDay: computeCommitsPerDay(input.dailyCommitCounts, now),
  };
}
