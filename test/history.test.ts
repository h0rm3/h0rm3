import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateDays, emptyHistory, mergeHistory } from "../src/history.js";
import { activeMinutes } from "../src/metrics.js";
import type { ParsedLogs } from "../src/types.js";

const logs: ParsedLogs = {
  messages: [
    { source: "claude-code", key: "a", timestamp: "2026-09-30T14:00:00Z", model: "claude-opus-5", family: "Opus", sessionId: "s1", sidechain: false, freshInput: 1, cacheWrite: 2, cacheRead: 3, output: 4 },
    { source: "claude-code", key: "b", timestamp: "2026-09-30T15:00:00Z", model: "claude-haiku-4-5", family: "Haiku", sessionId: "s1", sidechain: true, freshInput: 10, cacheWrite: 0, cacheRead: 0, output: 5 },
    // 01:30 UTC on Oct 1 is still Sep 30 in New York
    { source: "claude-code", key: "c", timestamp: "2026-10-01T01:30:00Z", model: "claude-opus-5", family: "Opus", sessionId: "s1", sidechain: false, freshInput: 1, cacheWrite: 0, cacheRead: 0, output: 1 },
  ],
  prompts: [
    { source: "claude-code", timestamp: "2026-09-30T13:59:00Z", sessionId: "s1", family: "Opus" },
    { source: "claude-code", timestamp: "2026-10-01T01:29:00Z", sessionId: "s1", family: "Opus" },
  ],
  tools: [{ timestamp: "2026-09-30T14:00:00Z", name: "Bash", sessionId: "s1" }],
  sessions: [{ source: "claude-code", sessionId: "s1", start: "2026-09-30T13:59:00Z", end: "2026-10-01T01:30:00Z", activeMinutes: 62, automated: false }],
};

test("aggregates per New York day, session counted once on its start day", () => {
  const days = aggregateDays("claude-code", logs);
  assert.deepEqual(Object.keys(days), ["2026-09-30"]);
  const d = days["2026-09-30"];
  assert.equal(d.all.freshInput, 12);
  assert.equal(d.all.output, 10);
  assert.equal(d.all.sessions, 1);
  assert.equal(d.all.prompts, 2);
  assert.equal(d.all.promptsByHour[9], 1); // 13:59Z = 09:59 EDT
  assert.equal(d.all.promptsByHour[21], 1); // 01:29Z = 21:29 EDT previous day
  assert.equal(d.families.Opus.sessions, 1);
  assert.equal(d.families.Haiku.sessions, 1);
  assert.equal(d.all.longestActiveSessionMinutes, 62);
  assert.deepEqual(d.all.tools, { Bash: 1 });
});

test("active session time ignores idle gaps over 30 minutes", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 8, 30, 14, 0) + min * 60_000).toISOString();
  // 0 -> 10 -> 20 (20 min active), 2h idle, 140 -> 145 (5 min), exactly-30-min gap 145 -> 175 counts
  assert.equal(activeMinutes([at(0), at(10), at(20), at(140), at(145), at(175)]), 55);
  assert.equal(activeMinutes([at(0), at(31)]), 0);
  assert.equal(activeMinutes([at(5)]), 0);
  assert.equal(activeMinutes([at(20), at(0), at(10)]), 20); // order-independent
});

test("parsed sessions get active time from their events, not first-to-last span", async () => {
  const logs = {
    ...{ messages: [], prompts: [], tools: [] },
    sessions: [{ source: "claude-code" as const, sessionId: "x", start: "2026-09-30T10:00:00Z", end: "2026-09-30T20:00:00Z", activeMinutes: 15, automated: false }],
  };
  const withMsg = { ...logs, messages: [{ source: "claude-code" as const, key: "k", timestamp: "2026-09-30T10:00:00Z", model: "claude-opus-5", family: "Opus", sessionId: "x", sidechain: false, freshInput: 1, cacheWrite: 0, cacheRead: 0, output: 1 }] };
  assert.equal(aggregateDays("claude-code", withMsg)["2026-09-30"].all.longestActiveSessionMinutes, 15);
});

test("merging the same day twice changes nothing", () => {
  const fresh = { "claude-code": aggregateDays("claude-code", logs) };
  const once = mergeHistory(emptyHistory(), fresh);
  const twice = mergeHistory(once, fresh);
  assert.deepEqual(twice, once);
  assert.equal(JSON.stringify(twice), JSON.stringify(once));
});

test("days deleted from the logs keep their recorded values", () => {
  const before = mergeHistory(emptyHistory(), { "claude-code": aggregateDays("claude-code", logs) });
  const afterDeletion = mergeHistory(before, { "claude-code": {} });
  assert.deepEqual(afterDeletion, before);
  const partial = mergeHistory(before, { "claude-code": aggregateDays("claude-code", { ...logs, messages: logs.messages.slice(0, 1) }) });
  assert.deepEqual(partial, before);
});
