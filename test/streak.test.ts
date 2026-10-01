import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStreaks } from "../src/metrics.js";

function day(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

test("no commits -> all zero", () => {
  const result = computeStreaks(new Map(), day(2026, 10, 1));
  assert.deepEqual(result, { totalCommits: 0, currentStreak: 0, longestStreak: 0 });
});

test("three consecutive days ending today -> current and longest both 3", () => {
  const counts = new Map([
    ["2026-09-29", 2],
    ["2026-09-30", 1],
    ["2026-10-01", 4],
  ]);
  const result = computeStreaks(counts, day(2026, 10, 1));
  assert.equal(result.totalCommits, 7);
  assert.equal(result.currentStreak, 3);
  assert.equal(result.longestStreak, 3);
});

test("most recent activity yesterday still counts toward current streak", () => {
  const counts = new Map([
    ["2026-09-29", 1],
    ["2026-09-30", 1],
  ]);
  const result = computeStreaks(counts, day(2026, 10, 1));
  assert.equal(result.currentStreak, 2);
});

test("a gap before today breaks the current streak but not the longest", () => {
  const counts = new Map([
    ["2026-09-20", 1],
    ["2026-09-21", 1],
    ["2026-09-22", 1],
    ["2026-09-23", 1],
    // gap
    ["2026-09-28", 1],
  ]);
  const result = computeStreaks(counts, day(2026, 10, 1));
  assert.equal(result.currentStreak, 0); // last activity was 3 days before "today"
  assert.equal(result.longestStreak, 4);
});

test("longest streak picks the longest run, not the most recent", () => {
  const counts = new Map([
    ["2026-01-01", 1],
    ["2026-01-02", 1],
    ["2026-01-03", 1],
    ["2026-01-04", 1],
    ["2026-01-05", 1],
    ["2026-09-30", 1],
    ["2026-10-01", 1],
  ]);
  const result = computeStreaks(counts, day(2026, 10, 1));
  assert.equal(result.currentStreak, 2);
  assert.equal(result.longestStreak, 5);
});
