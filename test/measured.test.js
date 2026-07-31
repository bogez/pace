/**
 * Measured usage parsing (bogez/pace#51): Claude Code statusline JSON →
 * normalized readings, and the reset-derived weekly window.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMeasured } from "../app/measured.js";
import { windowFromReset, WEEK_HOURS } from "../app/window.js";

const NOW = Date.parse("2026-07-30T12:00:00Z");
const secs = (ms) => Math.floor(ms / 1000);

test("parses raw statusline JSON: both windows, seconds → ms", () => {
  const m = parseMeasured(
    {
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: secs(NOW + 2 * 36e5) },
        seven_day: { used_percentage: 41.2, resets_at: secs(NOW + 72 * 36e5) },
      },
    },
    NOW
  );
  assert.equal(m.t, NOW); // raw paste has no stamp — taken as fresh
  assert.equal(m.weekly.pct, 41.2);
  assert.equal(m.weekly.resetsAt, NOW + 72 * 36e5);
  assert.equal(m.session.pct, 23.5);
  assert.equal(m.session.resetsAt, NOW + 2 * 36e5);
});

test("parses the bridge's teed file: generatedAt wins over now", () => {
  const stamped = NOW - 30 * 60e3;
  const m = parseMeasured(
    {
      source: "claude-code-statusline",
      generatedAt: new Date(stamped).toISOString(),
      rate_limits: { seven_day: { used_percentage: 50 } },
    },
    NOW
  );
  assert.equal(m.t, stamped);
  assert.equal(m.weekly.pct, 50);
  assert.equal(m.weekly.resetsAt, null); // resets_at independently absent
  assert.equal(m.session, null);
});

test("windows are independently absent (per the statusline docs)", () => {
  const m = parseMeasured(
    { rate_limits: { five_hour: { used_percentage: 12 } } },
    NOW
  );
  assert.equal(m.weekly, null);
  assert.equal(m.session.pct, 12);
});

test("rejects documents that aren't measured-usage shaped", () => {
  assert.equal(parseMeasured(null, NOW), null);
  assert.equal(parseMeasured({}, NOW), null);
  assert.equal(parseMeasured({ week: { weighted: 3e6 } }, NOW), null); // sensor doc
  assert.equal(parseMeasured({ rate_limits: {} }, NOW), null);
  assert.equal(parseMeasured({ rate_limits: { seven_day: {} } }, NOW), null);
});

test("rejects out-of-range percentages", () => {
  assert.equal(
    parseMeasured({ rate_limits: { seven_day: { used_percentage: 101 } } }, NOW),
    null
  );
  assert.equal(
    parseMeasured({ rate_limits: { seven_day: { used_percentage: -1 } } }, NOW),
    null
  );
});

test("tolerates resets_at already in milliseconds", () => {
  const m = parseMeasured(
    { rate_limits: { seven_day: { used_percentage: 10, resets_at: NOW + 36e5 } } },
    NOW
  );
  assert.equal(m.weekly.resetsAt, NOW + 36e5);
});

test("windowFromReset: mid-window position", () => {
  const now = new Date(NOW);
  const resetsAt = NOW + 72 * 36e5; // reset in 72 h → 96 h elapsed of 168
  const w = windowFromReset(now, resetsAt);
  assert.equal(w.start.getTime(), resetsAt - WEEK_HOURS * 36e5);
  assert.equal(w.elapsedHours, 96);
  assert.ok(Math.abs(w.elapsedPct - (96 / 168) * 100) < 1e-9);
});

test("windowFromReset: null when the reset already passed", () => {
  assert.equal(windowFromReset(new Date(NOW), NOW), null);
  assert.equal(windowFromReset(new Date(NOW), NOW - 1), null);
});

test("windowFromReset: null when the reset is more than one window out", () => {
  assert.equal(windowFromReset(new Date(NOW), NOW + (WEEK_HOURS + 1) * 36e5), null);
});
