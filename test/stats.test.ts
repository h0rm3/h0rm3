import { test } from "node:test";
import assert from "node:assert/strict";
import { aiBlock, heatmapColumns, topTools } from "../src/metrics.js";
import { aggregateDays, emptyHistory, mergeHistory } from "../src/history.js";
import { addDays } from "../src/tz.js";
import type { HeatmapDay, ParsedLogs } from "../src/types.js";

test("heatmap: 52 Sunday-first columns, every returned day placed once, totals preserved", () => {
  const start = "2025-10-05"; // a Sunday
  const days: HeatmapDay[] = [];
  for (let i = 0; i < 51 * 7 + 4; i++) days.push({ date: addDays(start, i), count: i % 5, level: i % 5 });
  const cols = heatmapColumns(days, start);
  assert.equal(cols.length, 52);
  assert.ok(cols.every((c) => c.length === 7));
  const placed = cols.flat().filter((d): d is HeatmapDay => d !== null);
  assert.equal(placed.length, days.length);
  assert.equal(placed.reduce((a, d) => a + d.count, 0), days.reduce((a, d) => a + d.count, 0));
  assert.equal(cols[0][0]!.date, start);
  assert.equal(cols[51][3]!.date, addDays(start, 51 * 7 + 3)); // Wednesday of the last week
  assert.equal(cols[51][4], null); // future days are empty
});

test("top tools: top 8 plus an Other row, percentages sum to 100", () => {
  const logs: ParsedLogs = {
    messages: [],
    prompts: [],
    sessions: [],
    tools: ["Bash", "Bash", "Bash", "Read", "Read", "Edit", "Grep", "Glob", "Write", "Agent", "Skill", "MCP", "WebFetch"].map((name, i) => ({
      name,
      timestamp: `2026-09-30T1${i % 10}:00:00Z`,
      sessionId: "s",
    })),
  };
  const h = mergeHistory(emptyHistory(), { "claude-code": aggregateDays("claude-code", logs) });
  const t = topTools(h);
  assert.equal(t.totalCalls, 13);
  assert.equal(t.rows.length, 9);
  assert.deepEqual(t.rows.slice(0, 2).map((r) => [r.label, r.value]), [["Bash", 3], ["Read", 2]]);
  assert.equal(t.rows[8].label, "Other (2 tools)"); // 10 distinct tools -> top 8 + 2 others
  assert.equal(t.rows[8].value, 2);
  assert.ok(Math.abs(t.rows.reduce((a, r) => a + r.percent, 0) - 100) <= 0.1 + 1e-9);
});

test("weekly totals never exceed all-time totals", () => {
  const msg = (ts: string) => ({ source: "claude-code" as const, key: ts, timestamp: ts, model: "claude-opus-5", family: "Opus", sessionId: ts, sidechain: false, freshInput: 1, cacheWrite: 1, cacheRead: 1, output: 1 });
  const logs: ParsedLogs = {
    messages: [msg("2026-01-01T15:00:00Z"), msg("2026-09-30T15:00:00Z")],
    prompts: [],
    tools: [],
    sessions: [
      { source: "claude-code", sessionId: "2026-01-01T15:00:00Z", start: "2026-01-01T15:00:00Z", end: "2026-01-01T15:00:00Z", activeMinutes: 0, automated: false },
      { source: "claude-code", sessionId: "2026-09-30T15:00:00Z", start: "2026-09-30T15:00:00Z", end: "2026-09-30T15:00:00Z", activeMinutes: 0, automated: false },
    ],
  };
  const h = mergeHistory(emptyHistory(), { "claude-code": aggregateDays("claude-code", logs) });
  const week = aiBlock(h, "claude-code", ["2026-09-28", "2026-09-29", "2026-09-30"]);
  const all = aiBlock(h, "claude-code", null);
  assert.equal(week.output, 1);
  assert.equal(all.output, 2);
  assert.equal(week.sessions, 1);
  assert.equal(all.sessions, 2);
});
