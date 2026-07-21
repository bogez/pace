import { test } from "node:test";
import assert from "node:assert/strict";
import { paceDelta, paceColorRgb, paceState, forecast } from "../src/pace.js";

test("delta is zero when exactly on pace", () => {
  assert.equal(paceDelta(50, 84, 168), 0);
});

test("day-4 example from the original idea: 57.14% at end of day 4 is on pace", () => {
  const d = paceDelta(57.14, 4 * 24, 168);
  assert.ok(Math.abs(d) < 0.01, `expected ~0, got ${d}`);
});

test("positive delta when hot, negative when cold", () => {
  assert.ok(paceDelta(90, 24, 168) > 0);
  assert.ok(paceDelta(10, 120, 168) < 0);
});

test("throws on non-positive window", () => {
  assert.throws(() => paceDelta(50, 10, 0), RangeError);
});

test("green inside the zone, red when far hot, blue when far cold", () => {
  assert.deepEqual(paceColorRgb(0), [12, 163, 12]);
  assert.deepEqual(paceColorRgb(4.9), [12, 163, 12]);
  assert.deepEqual(paceColorRgb(30), [208, 59, 59]);
  assert.deepEqual(paceColorRgb(-60), [28, 92, 171]);
});

test("red ramp is steeper than blue ramp (asymmetry is intentional)", () => {
  // at |delta| = 20, hot side should be much further from green than cold side
  const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  const green = paceColorRgb(0);
  assert.ok(dist(paceColorRgb(20), green) > dist(paceColorRgb(-20), green));
});

test("states and glyphs", () => {
  assert.equal(paceState(0).name, "in the zone");
  assert.equal(paceState(0).glyph, "●");
  assert.equal(paceState(10).name, "warm");
  assert.equal(paceState(30).name, "overheating");
  assert.equal(paceState(-10).name, "cool");
  assert.equal(paceState(-30).name, "cold");
});

test("forecast projects linearly and flags run-out", () => {
  // 50% used at half-window → lands exactly at 100%, does not run out early
  const f = forecast(50, 84, 168);
  assert.ok(Math.abs(f.projectedPct - 100) < 1e-9);
  assert.equal(f.runsOut, false);

  // 90% used on day 2 → runs out well before reset
  const hot = forecast(90, 48, 168);
  assert.equal(hot.runsOut, true);
  assert.ok(hot.projectedPct > 100);

  // real Monday-night numbers: 53% at 112h → ~79%, safe
  const jon = forecast(53, 112, 168);
  assert.equal(jon.runsOut, false);
  assert.ok(Math.abs(jon.projectedPct - 79.5) < 0.5);
});

test("forecast returns null with nothing to extrapolate", () => {
  assert.equal(forecast(0, 10, 168), null);
  assert.equal(forecast(50, 0, 168), null);
});
