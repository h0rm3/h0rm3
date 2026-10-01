import type { History, HistoryDay, ParsedLogs, Source, SourceDay, Totals } from "./types.js";
import { TZ, dateKey, hourOf } from "./tz.js";

const zeroTotals = (): Totals => ({ freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0, sessions: 0, prompts: 0 });

function emptySourceDay(): SourceDay {
  return { all: { ...zeroTotals(), promptsByHour: Array(24).fill(0), longestActiveSessionMinutes: 0, tools: {} }, families: {} };
}

export function emptyHistory(): History {
  return { version: 1, timezone: TZ, days: {} };
}

/**
 * Per-New-York-day aggregates for one source.
 * Tokens/prompts/tools land on the day they happened; a session counts once, on the day it started.
 */
export function aggregateDays(source: Source, logs: ParsedLogs): Record<string, SourceDay> {
  const days: Record<string, SourceDay> = {};
  const day = (key: string) => (days[key] ??= emptySourceDay());
  const fam = (sd: SourceDay, f: string) => (sd.families[f] ??= zeroTotals());

  const sessionFamilies = new Map<string, Set<string>>();
  for (const m of logs.messages) {
    if (m.model === "<synthetic>") continue;
    const sd = day(dateKey(m.timestamp));
    for (const t of [sd.all, fam(sd, m.family)]) {
      t.freshInput += m.freshInput;
      t.cacheWrite += m.cacheWrite;
      t.cacheRead += m.cacheRead;
      t.output += m.output;
    }
    const set = sessionFamilies.get(m.sessionId) ?? new Set();
    set.add(m.family);
    sessionFamilies.set(m.sessionId, set);
  }

  for (const p of logs.prompts) {
    const sd = day(dateKey(p.timestamp));
    sd.all.prompts++;
    sd.all.promptsByHour[hourOf(p.timestamp)]++;
    if (p.family) fam(sd, p.family).prompts++;
  }

  for (const t of logs.tools) {
    const sd = day(dateKey(t.timestamp));
    sd.all.tools[t.name] = (sd.all.tools[t.name] ?? 0) + 1;
  }

  for (const s of logs.sessions) {
    const families = sessionFamilies.get(s.sessionId);
    if (!families || s.automated) continue; // no model usage, or a programmatic SDK run -> not a session
    const sd = day(dateKey(s.start));
    sd.all.sessions++;
    for (const f of families) fam(sd, f).sessions++;
    sd.all.longestActiveSessionMinutes = Math.max(sd.all.longestActiveSessionMinutes, s.activeMinutes);
  }

  return days;
}

function maxTotals(a: Totals | undefined, b: Totals | undefined): Totals {
  return {
    freshInput: Math.max(a?.freshInput ?? 0, b?.freshInput ?? 0),
    cacheWrite: Math.max(a?.cacheWrite ?? 0, b?.cacheWrite ?? 0),
    cacheRead: Math.max(a?.cacheRead ?? 0, b?.cacheRead ?? 0),
    output: Math.max(a?.output ?? 0, b?.output ?? 0),
    sessions: Math.max(a?.sessions ?? 0, b?.sessions ?? 0),
    prompts: Math.max(a?.prompts ?? 0, b?.prompts ?? 0),
  };
}

function sortedKeys<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

function mergeSourceDay(a: SourceDay | undefined, b: SourceDay | undefined): SourceDay {
  const toolNames = new Set([...Object.keys(a?.all.tools ?? {}), ...Object.keys(b?.all.tools ?? {})]);
  const famNames = new Set([...Object.keys(a?.families ?? {}), ...Object.keys(b?.families ?? {})]);
  const tools: Record<string, number> = {};
  for (const n of toolNames) tools[n] = Math.max(a?.all.tools[n] ?? 0, b?.all.tools[n] ?? 0);
  const families: Record<string, Totals> = {};
  for (const f of famNames) families[f] = maxTotals(a?.families[f], b?.families[f]);
  return {
    all: {
      ...maxTotals(a?.all, b?.all),
      promptsByHour: Array.from({ length: 24 }, (_, h) => Math.max(a?.all.promptsByHour[h] ?? 0, b?.all.promptsByHour[h] ?? 0)),
      // Only the active-time field is carried; the old wall-clock `longestSessionMinutes` is dropped on merge.
      longestActiveSessionMinutes: Math.max(a?.all.longestActiveSessionMinutes ?? 0, b?.all.longestActiveSessionMinutes ?? 0),
      tools: sortedKeys(tools),
    },
    families: sortedKeys(families),
  };
}

/**
 * Field-wise max merge. Old logs get deleted by Claude Code, so a day that is now partially or
 * fully missing from the logs keeps its recorded values; a day still fully present recomputes to the
 * same numbers. Max is idempotent and order-independent, so re-merging the same data changes nothing.
 */
export function mergeHistory(base: History, fresh: Partial<Record<Source, Record<string, SourceDay>>>): History {
  const days: Record<string, HistoryDay> = { ...base.days };
  for (const source of Object.keys(fresh) as Source[]) {
    for (const [key, sd] of Object.entries(fresh[source] ?? {})) {
      days[key] = { ...days[key], [source]: mergeSourceDay(days[key]?.[source], sd) };
    }
  }
  const out: Record<string, HistoryDay> = {};
  for (const key of Object.keys(days).sort()) {
    const d = days[key];
    out[key] = Object.fromEntries((["claude-code", "codex"] as Source[]).filter((s) => d[s]).map((s) => [s, d[s]]));
  }
  return { version: 1, timezone: TZ, days: out };
}

export function parseHistory(json: string | null): History {
  if (!json) return emptyHistory();
  const h = JSON.parse(json) as History;
  if (h.version !== 1 || h.timezone !== TZ) throw new Error(`Unsupported history file (version ${h.version}, tz ${h.timezone})`);
  return h;
}
