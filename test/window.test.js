/**
 * Window-math suite (bogez/pace#5). All times constructed explicitly —
 * these tests must pass in any timezone, so they only use local-time Dates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lastWeeklyReset,
  weeklyWindow,
  sessionWindow,
  WEEK_HOURS,
  SESSION_HOURS,
} from "../app/window.js";

// A known anchor: 2026-07-21 is a Tuesday (getDay() === 2).
const tue = (h, m = 0) => new Date(2026, 6, 21, h, m);

test("reset earlier in the same week", () => {
  // Reset Thursday 5 AM; on Tuesday the last reset was the previous Thursday.
  const r = lastWeeklyReset(tue(12), 4, 5);
  assert.equal(r.getDay(), 4);
  assert.equal(r.getHours(), 5);
  assert.equal(r.getDate(), 16); // Thu 2026-07-16
});

test("reset on the same day: before vs after the hour", () => {
  // Reset Tuesday 5 AM, queried Tuesday noon → this morning.
  const after = lastWeeklyReset(tue(12), 2, 5);
  assert.equal(after.getDate(), 21);
  // Queried Tuesday 4 AM → last week's Tuesday.
  const before = lastWeeklyReset(tue(4), 2, 5);
  assert.equal(before.getDate(), 14);
});

test("exactly at the reset instant, the window restarts", () => {
  const r = lastWeeklyReset(tue(5), 2, 5);
  assert.equal(r.getDate(), 21);
  assert.equal(weeklyWindow(tue(5), 2, 5).elapsedHours, 0);
});

test("weekly window elapsed matches the anchor arithmetic", () => {
  // Thu 05:00 → Tue 12:00 is 5 days 7 hours = 127 h.
  const w = weeklyWindow(tue(12), 4, 5);
  assert.equal(w.elapsedHours, 127);
  assert.ok(Math.abs(w.elapsedPct - (127 / WEEK_HOURS) * 100) < 1e-9);
});

test("session window: mid-session, expired, and nonsense inputs", () => {
  const now = tue(12);
  // Resets at 3 PM → 3 h remaining → 2 h elapsed of 5.
  assert.equal(sessionWindow(now, tue(15)).elapsedHours, SESSION_HOURS - 3);
  // Already reset → null (stale session data means nothing).
  assert.equal(sessionWindow(now, tue(11)), null);
  // Claims to reset 9 h out — longer than a session can be → null.
  assert.equal(sessionWindow(now, tue(21)), null);
});
