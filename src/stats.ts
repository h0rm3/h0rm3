import type { CommitRecord, History, Stats } from "./types.js";
import type { GitHubData } from "./github.js";
import {
  aiBlock,
  builderProfile,
  claudeAllTimeExtras,
  computeStreaks,
  languageRows,
  promptsByDay,
  series,
  topTools,
  weekDays,
} from "./metrics.js";
import { TZ, dateKey, dayDiff, lastNDays } from "./tz.js";

export function buildStats(input: {
  now: Date;
  history: History;
  github: Omit<GitHubData, "privateRepoNames" | "commits">;
  commits: CommitRecord[];
  badges: string[];
}): Stats {
  const { now, history, github } = input;
  const today = dateKey(now);
  const last90 = lastNDays(today, 90);
  const last90Set = new Set(last90);

  const topRepos = Object.entries(github.publicRepoDays)
    .map(([name, days]) => ({ name, commits: Object.entries(days).filter(([k]) => last90Set.has(k)).reduce((a, [, n]) => a + n, 0) }))
    .filter((r) => r.commits > 0)
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
    .slice(0, 5);

  const commitDays = Object.fromEntries(Object.keys(github.commitDays).sort().filter((k) => github.commitDays[k] > 0).map((k) => [k, github.commitDays[k]]));

  return {
    generatedAt: now.toISOString(),
    timezone: TZ,
    claudeWeek: aiBlock(history, "claude-code", weekDays(today)),
    claudeAllTime: { ...aiBlock(history, "claude-code", null), ...claudeAllTimeExtras(history) },
    codexAllTime: aiBlock(history, "codex", null),
    topTools: topTools(history),
    builderProfile: builderProfile(input.commits, history),
    languages: languageRows(github.languages),
    streak: computeStreaks(commitDays, today),
    commitsPerDay: series(last90, commitDays),
    promptsPerDay: series(last90, promptsByDay(history)),
    commitDays,
    heatmap: {
      days: github.heatmap.days,
      total: github.heatmap.days.reduce((a, d) => a + d.count, 0),
      apiTotal: github.heatmap.apiTotal,
      weeks: 52,
      startKey: github.heatmap.startKey,
    },
    github: {
      contributionsThisYear: github.contributionsThisYear,
      year: Number(today.slice(0, 4)),
      prsOpened: github.profile.prsOpened,
      prsMerged: github.profile.prsMerged,
      issuesOpened: github.profile.issuesOpened,
      starsReceived: github.profile.starsReceived,
      publicRepos: github.profile.publicRepos,
      accountCreated: dateKey(github.profile.createdAt),
      accountAgeDays: dayDiff(today, dateKey(github.profile.createdAt)),
    },
    topRepos,
    badges: input.badges,
  };
}
