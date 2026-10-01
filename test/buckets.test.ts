import { test } from "node:test";
import assert from "node:assert/strict";
import { timeBucket, weekdayName, computeTimeBuckets, WEEKDAY_ORDER } from "../src/metrics.js";

function at(hour: number, minute = 0): Date {
  return new Date(2026, 5, 15, hour, minute);
}

test("time bucket boundaries", () => {
  assert.equal(timeBucket(at(5, 0)), "Morning");
  assert.equal(timeBucket(at(11, 59)), "Morning");
  assert.equal(timeBucket(at(12, 0)), "Daytime");
  assert.equal(timeBucket(at(16, 59)), "Daytime");
  assert.equal(timeBucket(at(17, 0)), "Evening");
  assert.equal(timeBucket(at(20, 59)), "Evening");
  assert.equal(timeBucket(at(21, 0)), "Night");
  assert.equal(timeBucket(at(23, 59)), "Night");
});

test("Night bucket wraps past midnight", () => {
  assert.equal(timeBucket(at(0, 0)), "Night");
  assert.equal(timeBucket(at(4, 59)), "Night");
  // and the boundary right before Morning starts
  assert.notEqual(timeBucket(at(5, 0)), "Night");
});

test("late-night and early-morning-of-next-day events both count as one Night bucket", () => {
  const lateNight = new Date(2026, 5, 15, 23, 30);
  const earlyMorning = new Date(2026, 5, 16, 0, 30);
  const result = computeTimeBuckets([lateNight, earlyMorning]);
  const night = result.find((b) => b.bucket === "Night")!;
  assert.equal(night.count, 2);
  assert.equal(night.percent, 100);
});

// Jan 1 2026 is a Thursday, so Jan 5 2026 is a Monday.
test("weekday names, Monday-first", () => {
  for (let i = 0; i < 7; i++) {
    const d = new Date(2026, 0, 5 + i, 12);
    assert.equal(weekdayName(d), WEEKDAY_ORDER[i]);
  }
});
