export type ModelFamily = string;

/** One AI assistant turn, normalized across Claude Code / Codex / future sources. */
export interface AiTurn {
  source: "claude-code" | "codex";
  timestamp: string; // ISO 8601
  model: string; // raw model id as reported by the tool
  family: ModelFamily;
  sessionId: string;
  freshInputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

/** One user prompt, normalized across sources. */
export interface AiPrompt {
  source: "claude-code" | "codex";
  timestamp: string; // ISO 8601
  sessionId: string;
}

export interface CommitRecord {
  timestamp: string; // ISO 8601
  repo: string;
  sha: string;
}

export interface LanguageTotals {
  [language: string]: number; // bytes, summed across all repos
}

export interface TimeBucketStats {
  bucket: string;
  count: number;
  percent: number;
  bar: string;
}

export interface WeekdayStats {
  weekday: string;
  count: number;
  percent: number;
  bar: string;
}

export interface ModelFamilyWeekStats {
  family: string;
  tokens: number;
  bar: string;
  percent: number;
}

export interface Stats {
  generatedAt: string;
  timezone: string;
  aiWeek: {
    freshInputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    totalInputTokens: number; // fresh + cache-creation + cache-read
    totalTokens: number;
    sessions: number;
    prompts: number;
    families: ModelFamilyWeekStats[];
  };
  builderProfile: {
    timeBuckets: TimeBucketStats[];
    weekdays: WeekdayStats[];
    headline: string;
  };
  languages: {
    name: string;
    bytes: number;
    percent: number;
  }[];
  streak: {
    totalCommits: number;
    currentStreak: number;
    longestStreak: number;
  };
  commitsPerDay: {
    date: string; // YYYY-MM-DD
    count: number;
  }[];
}
