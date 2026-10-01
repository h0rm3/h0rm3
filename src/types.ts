export type Source = "claude-code" | "codex";

/** One model response after dedupe (streamed duplicates merged). */
export interface AiMessage {
  source: Source;
  key: string;
  timestamp: string; // ISO 8601, earliest line seen for this message
  model: string; // raw model id
  family: string;
  sessionId: string;
  sidechain: boolean;
  freshInput: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

/** One human-typed prompt (sidechain / system-injected turns excluded). */
export interface AiPrompt {
  source: Source;
  timestamp: string;
  sessionId: string;
  family: string | null; // family of the next main-chain response, if any
}

export interface ToolCall {
  timestamp: string;
  name: string;
  sessionId: string;
}

export interface SessionSpan {
  source: Source;
  sessionId: string;
  start: string;
  end: string;
}

export interface ParsedLogs {
  messages: AiMessage[]; // includes "<synthetic>" placeholders; aggregation filters them
  prompts: AiPrompt[];
  tools: ToolCall[];
  sessions: SessionSpan[];
}

export interface CommitRecord {
  timestamp: string;
  repo: string;
  sha: string;
}

export interface LanguageTotals {
  [language: string]: number;
}

export interface Totals {
  freshInput: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  sessions: number;
  prompts: number;
}

export interface SourceDay {
  all: Totals & {
    promptsByHour: number[]; // 24 buckets, New York hour
    longestSessionMinutes: number; // among sessions started this day
    tools: Record<string, number>;
  };
  families: Record<string, Totals>;
}

export type HistoryDay = Partial<Record<Source, SourceDay>>;

export interface History {
  version: 1;
  timezone: string;
  days: Record<string, HistoryDay>;
}

export interface Row {
  label: string;
  value: number;
  percent: number;
}

export interface AiBlock {
  freshInput: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  totalInput: number;
  sessions: number;
  prompts: number;
  families: Row[];
}

export interface HeatmapDay {
  date: string;
  count: number;
  level: number; // 0-4, GitHub's own quartile level
}

export interface Stats {
  generatedAt: string;
  timezone: string;
  claudeWeek: AiBlock;
  claudeAllTime: AiBlock & {
    avgPromptsPerSession: number | null;
    longestSessionMinutes: number | null;
    mostActiveHour: number | null;
    firstDay: string | null;
  };
  codexAllTime: AiBlock;
  topTools: { totalCalls: number; rows: Row[] };
  builderProfile: { timeBuckets: Row[]; weekdays: Row[]; headline: string; commitEvents: number; promptEvents: number };
  languages: Row[];
  streak: { totalCommits: number; currentStreak: number; longestStreak: number };
  commitsPerDay: { date: string; count: number }[];
  promptsPerDay: { date: string; count: number }[];
  commitDays: Record<string, number>; // GitHub commit contributions per GitHub calendar day, all time
  heatmap: { days: HeatmapDay[]; total: number; apiTotal: number; weeks: number; startKey: string };
  github: {
    contributionsThisYear: number;
    year: number;
    prsOpened: number;
    prsMerged: number;
    issuesOpened: number;
    starsReceived: number;
    publicRepos: number;
    accountCreated: string;
    accountAgeDays: number;
  };
  topRepos: { name: string; commits: number }[];
  badges: string[];
}
