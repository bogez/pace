/**
 * Tray-dot presentation suite (bogez/pace#16): the pure mapping from a
 * reading to the dot's RGB + tooltip. The dot is 16 pixels of the same
 * product — every honesty rule (never color alone, estimated marked, stale
 * degraded) is pinned here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { trayState, GRAY } from "../app/tray-format.js";
import { PALETTE } from "../src/pace.js";
import { weeklyWindow } from "../app/window.js";

// A week that started Thursday 05:00 local; "now" is 84 h in (50% elapsed).
const start = new Date(2026, 6, 16, 5, 0, 0, 0);
const now = new Date(start.getTime() + 84 * 3600e3);
const win = weeklyWindow(now, 4, 5);

const reading = (pct, ageHours, estimated = false) => ({
  pct,
  t: now.getTime() - ageHours * 3600e3,
  estimated,
});

test("no data: gray dot, tooltip still carries glyph and words", () => {
  const { rgb, tooltip } = trayState(null, win, now);
  assert.deepEqual(rgb, [...GRAY]);
  assert.match(tooltip, /●/);
  assert.match(tooltip, /no data yet/);
});

test("on pace + fresh: engine green, glyph, state name, both percents", () => {
  const { rgb, tooltip } = trayState(reading(50, 1), win, now);
  assert.deepEqual(rgb, [...PALETTE.green]);
  assert.match(tooltip, /●/);
  assert.match(tooltip, /in the zone/);
  assert.match(tooltip, /50% used/);
  assert.match(tooltip, /50% of the week elapsed/);
  assert.doesNotMatch(tooltip, /≈|estimated|probably|check \/usage/);
});

test("estimated readings are marked on the text channel (TRUST.md 5)", () => {
  const { tooltip } = trayState(reading(50, 1, true), win, now);
  assert.match(tooltip, /≈50% used \(estimated\)/);
});

test("hot reading keeps the ▲▲ glyph alongside the red ramp", () => {
  const { rgb, tooltip } = trayState(reading(80, 1), win, now); // delta +30
  assert.deepEqual(rgb, [...PALETTE.red]);
  assert.match(tooltip, /▲▲/);
  assert.match(tooltip, /overheating/);
});

test("stale readings desaturate the dot and hedge the words (#9 grammar)", () => {
  const fresh = trayState(reading(50, 1), win, now);
  const stale = trayState(reading(50, 30), win, now);
  assert.match(stale.tooltip, /probably in the zone/);
  assert.match(stale.tooltip, /check \/usage/);
  assert.deepEqual(
    stale.rgb,
    fresh.rgb.map((v, i) => Math.round((v + GRAY[i]) / 2))
  );
});

test("aging readings keep full color but already ask for a fresh look", () => {
  const { rgb, tooltip } = trayState(reading(50, 18), win, now);
  assert.deepEqual(rgb, [...PALETTE.green]);
  assert.doesNotMatch(tooltip, /probably/);
  assert.match(tooltip, /check \/usage/);
});
