import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStreaks } from "../src/metrics.js";

test("no commits -> all zero", () => {
  assert.deepEqual(computeStreaks({}, "2026-10-01"), { totalCommits: 0, currentStreak: 0, longestStreak: 0 });
});

test("three consecutive days ending today -> current and longest both 3", () => {
  const r = computeStreaks({ "2026-09-29": 2, "2026-09-30": 1, "2026-10-01": 4 }, "2026-10-01");
  assert.deepEqual(r, { totalCommits: 7, currentStreak: 3, longestStreak: 3 });
});

test("most recent activity yesterday still counts toward current streak", () => {
  assert.equal(computeStreaks({ "2026-09-29": 1, "2026-09-30": 1 }, "2026-10-01").currentStreak, 2);
});

test("a gap before today breaks the current streak but not the longest", () => {
  const r = computeStreaks({ "2026-09-20": 1, "2026-09-21": 1, "2026-09-22": 1, "2026-09-23": 1, "2026-09-28": 1 }, "2026-10-01");
  assert.equal(r.currentStreak, 0);
  assert.equal(r.longestStreak, 4);
});

test("longest streak picks the longest run, not the most recent", () => {
  const days: Record<string, number> = { "2026-09-30": 1, "2026-10-01": 1 };
  for (let d = 1; d <= 5; d++) days[`2026-01-0${d}`] = 1;
  const r = computeStreaks(days, "2026-10-01");
  assert.equal(r.currentStreak, 2);
  assert.equal(r.longestStreak, 5);
});

test("streak crosses month and DST boundaries by calendar day", () => {
  const r = computeStreaks({ "2026-10-31": 1, "2026-11-01": 1, "2026-11-02": 1 }, "2026-11-02");
  assert.equal(r.currentStreak, 3);
});

test("zero-count days are not active", () => {
  assert.equal(computeStreaks({ "2026-09-30": 0, "2026-10-01": 1 }, "2026-10-01").currentStreak, 1);
});
