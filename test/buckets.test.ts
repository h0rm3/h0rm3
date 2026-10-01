import { test } from "node:test";
import assert from "node:assert/strict";
import { timeBucketOfHour, weekdayName, WEEKDAY_ORDER, percentRows } from "../src/metrics.js";
import { dateKey, hourOf, zonedTimeToUtc } from "../src/tz.js";

test("time bucket boundaries", () => {
  assert.equal(timeBucketOfHour(5), "Morning");
  assert.equal(timeBucketOfHour(11), "Morning");
  assert.equal(timeBucketOfHour(12), "Daytime");
  assert.equal(timeBucketOfHour(16), "Daytime");
  assert.equal(timeBucketOfHour(17), "Evening");
  assert.equal(timeBucketOfHour(20), "Evening");
  assert.equal(timeBucketOfHour(21), "Night");
  assert.equal(timeBucketOfHour(23), "Night");
});

test("Night bucket wraps past midnight", () => {
  assert.equal(timeBucketOfHour(0), "Night");
  assert.equal(timeBucketOfHour(4), "Night");
  assert.notEqual(timeBucketOfHour(5), "Night");
});

test("instants are bucketed in America/New_York regardless of machine timezone", () => {
  // 03:30 UTC on Jun 16 is 23:30 EDT on Jun 15
  assert.equal(dateKey("2026-06-16T03:30:00Z"), "2026-06-15");
  assert.equal(hourOf("2026-06-16T03:30:00Z"), 23);
  assert.equal(timeBucketOfHour(hourOf("2026-06-16T03:30:00Z")), "Night");
  // winter (EST, UTC-5): 04:59 UTC Jan 10 is 23:59 Jan 9
  assert.equal(dateKey("2026-01-10T04:59:00Z"), "2026-01-09");
  assert.equal(dateKey("2026-01-10T05:00:00Z"), "2026-01-10");
});

test("zonedTimeToUtc handles both DST offsets", () => {
  assert.equal(zonedTimeToUtc("2026-07-01").toISOString(), "2026-07-01T04:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-01-01").toISOString(), "2026-01-01T05:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-07-01", 0, "America/Los_Angeles").toISOString(), "2026-07-01T07:00:00.000Z");
});

// Jan 1 2026 is a Thursday, so Jan 5 2026 is a Monday.
test("weekday names, Monday-first", () => {
  for (let i = 0; i < 7; i++) assert.equal(weekdayName(`2026-01-${String(5 + i).padStart(2, "0")}`), WEEKDAY_ORDER[i]);
});

const drift = (rows: { percent: number }[]) => Math.abs(rows.reduce((a, r) => a + r.percent, 0) - 100);

test("percentages sum to 100 within 0.1, and equal values get equal percents when possible", () => {
  const seven = percentRows([1, 1, 1, 1, 1, 1, 1].map((value, i) => ({ label: String(i), value })));
  assert.ok(drift(seven) <= 0.1 + 1e-9);
  assert.ok(seven.every((r) => r.percent === 14.3));
  // 12 equal items round to 8.3 each = 99.6, so the largest-remainder fallback kicks in
  const twelve = percentRows(Array.from({ length: 12 }, (_, i) => ({ label: String(i), value: 1 })));
  assert.ok(drift(twelve) <= 0.1 + 1e-9);
  const skewed = percentRows([{ label: "a", value: 9991 }, { label: "b", value: 3 }, { label: "c", value: 3 }, { label: "d", value: 3 }]);
  assert.ok(drift(skewed) <= 0.1 + 1e-9);
});
