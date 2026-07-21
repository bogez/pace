/**
 * Edge-case suite (bogez/pace#4): exact zone boundaries, ramp monotonicity,
 * forecast edges, and out-of-domain inputs. The original 9 prototype tests
 * live untouched in pace.test.js — this file pins everything they left
 * unspecified, so the engine can never surprise a shell.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paceDelta,
  paceColorRgb,
  paceState,
  forecast,
  ZONES,
  PALETTE,
} from "../src/pace.js";

/* ---------------- exact boundary values ---------------- */
// Convention pinned here: every boundary value belongs to the milder zone.
// delta = 5 is still "in the zone"; delta = 25 is still "running hot".

test("hot boundaries: 5, 15, 25 exactly", () => {
  assert.deepEqual(paceColorRgb(5), [...PALETTE.green]);
  assert.equal(paceState(5).name, "in the zone");

  assert.deepEqual(paceColorRgb(15), [...PALETTE.yellow]); // ramp lands exactly on yellow
  assert.equal(paceState(15).name, "warm");

  assert.deepEqual(paceColorRgb(25), [...PALETTE.red]);
  assert.equal(paceState(25).name, "running hot");
});

test("just past each hot boundary, zone changes", () => {
  // State flips immediately at the boundary; color is 8-bit so a hair past
  // the boundary still rounds to the anchor (paceColorRgb(5.01) IS green) —
  // that's fine, the state/glyph channel carries the flip. Color must have
  // visibly moved within one delta-point.
  assert.deepEqual(paceColorRgb(5.01), [...PALETTE.green]);
  assert.notDeepEqual(paceColorRgb(6), [...PALETTE.green]);
  assert.equal(paceState(5.01).name, "warm");
  assert.equal(paceState(15.01).name, "running hot");
  assert.equal(paceState(25.01).name, "overheating");
  assert.deepEqual(paceColorRgb(25.01), [...PALETTE.red]); // red saturates
});

test("cold boundaries: −5, −25, −50 exactly", () => {
  assert.deepEqual(paceColorRgb(-5), [...PALETTE.green]);
  assert.equal(paceState(-5).name, "in the zone");

  assert.deepEqual(paceColorRgb(-25), [...PALETTE.teal]);
  assert.equal(paceState(-25).name, "cool");

  assert.deepEqual(paceColorRgb(-50), [...PALETTE.blue]);
  assert.equal(paceState(-50).name, "cold");

  assert.deepEqual(paceColorRgb(-50.01), [...PALETTE.deepBlue]); // floor
  assert.equal(paceState(-50.01).name, "cold");
});

/* ---------------- ramp monotonicity ---------------- */
// Within each ramp segment every RGB channel must move in one direction only —
// lerp rounding must never make a color step "backwards" as delta rises.

const segments = [
  { name: "green→yellow", from: ZONES.green, to: ZONES.hot.yellow, sign: +1 },
  { name: "yellow→red", from: ZONES.hot.yellow, to: ZONES.hot.red, sign: +1 },
  { name: "green→teal", from: ZONES.green, to: ZONES.cold.teal, sign: -1 },
  { name: "teal→blue", from: ZONES.cold.teal, to: ZONES.cold.blue, sign: -1 },
];

for (const { name, from, to, sign } of segments) {
  test(`channel monotonicity across ${name}`, () => {
    const STEPS = 200;
    let prev = paceColorRgb(sign * from);
    // direction each channel is allowed to move: sign of (end − start)
    const start = paceColorRgb(sign * from);
    const end = paceColorRgb(sign * to);
    const dir = start.map((v, i) => Math.sign(end[i] - v));
    for (let s = 1; s <= STEPS; s++) {
      const delta = sign * (from + ((to - from) * s) / STEPS);
      const cur = paceColorRgb(delta);
      for (let ch = 0; ch < 3; ch++) {
        const moved = cur[ch] - prev[ch];
        assert.ok(
          moved === 0 || Math.sign(moved) === dir[ch],
          `${name} ch${ch} moved ${moved} against direction ${dir[ch]} at delta=${delta}`
        );
      }
      prev = cur;
    }
  });
}

/* ---------------- state ↔ color consistency ---------------- */

test("every state's representative delta maps into that state's color family", () => {
  const cases = [
    { delta: 0, state: "in the zone", family: [PALETTE.green] },
    { delta: 10, state: "warm", family: [PALETTE.green, PALETTE.yellow] },
    { delta: 20, state: "running hot", family: [PALETTE.yellow, PALETTE.red] },
    { delta: 30, state: "overheating", family: [PALETTE.red] },
    { delta: -15, state: "cool", family: [PALETTE.green, PALETTE.teal] },
    { delta: -40, state: "cold", family: [PALETTE.teal, PALETTE.blue] },
  ];
  for (const { delta, state, family } of cases) {
    assert.equal(paceState(delta).name, state);
    const c = paceColorRgb(delta);
    // each channel must lie within the bounding box of the family anchors
    for (let ch = 0; ch < 3; ch++) {
      const lo = Math.min(...family.map((f) => f[ch]));
      const hi = Math.max(...family.map((f) => f[ch]));
      assert.ok(c[ch] >= lo && c[ch] <= hi, `delta ${delta} ch${ch}=${c[ch]} outside [${lo},${hi}]`);
    }
  }
});

/* ---------------- forecast edges ---------------- */

test("forecast when already over 100%", () => {
  const f = forecast(120, 50, 168);
  assert.equal(f.unitsToExhaustion, 0); // already exhausted
  assert.equal(f.runsOut, true);
  assert.ok(f.projectedPct > 120);
});

test("forecast at exactly 100%", () => {
  const f = forecast(100, 50, 168);
  assert.equal(f.unitsToExhaustion, 0);
  assert.equal(f.runsOut, true);
});

test("forecast when exhaustion lands exactly on the reset is not 'runs out'", () => {
  // 50% at half-window: hits 100% precisely at the reset — the cap and the
  // reset coincide, so the user is never actually cut off. Pinned by the
  // strict '<' in the engine.
  const f = forecast(50, 84, 168);
  assert.equal(f.runsOut, false);
});

test("forecast with elapsed past the window end (overrun)", () => {
  // Out-of-domain but must stay sane: shells are responsible for rolling the
  // window; if they lag, projectedPct is what the *whole* window would have
  // used at the average rate — smaller than current usage, and runsOut stays
  // false. Pinned so a lagging shell shows conservative numbers, not chaos.
  const f = forecast(50, 200, 168);
  assert.ok(f.projectedPct < 50);
  assert.equal(f.runsOut, false);
});

/* ---------------- paceDelta domain ---------------- */

test("paceDelta with elapsed past the window end goes deeply negative", () => {
  // expected% exceeds 100 → big headroom reading. Sane, pinned.
  assert.equal(paceDelta(50, 336, 168), -150);
});

test("paceDelta throws on negative elapsed (decided in #4: refuse, don't extrapolate)", () => {
  assert.throws(() => paceDelta(50, -1, 168), RangeError);
});

/* ---------------- the data exports are really data ---------------- */

test("ZONES and PALETTE are deeply frozen", () => {
  assert.ok(Object.isFrozen(ZONES) && Object.isFrozen(ZONES.hot) && Object.isFrozen(ZONES.cold));
  assert.ok(Object.isFrozen(PALETTE) && Object.values(PALETTE).every(Object.isFrozen));
});

test("the asymmetry is pinned in the data itself", () => {
  // Full red arrives at +25; full blue not until −50. Overuse ramps twice as
  // fast because overuse has a hard consequence. Changing this takes an issue.
  assert.ok(ZONES.hot.red < ZONES.cold.blue);
  assert.equal(ZONES.hot.red, 25);
  assert.equal(ZONES.cold.blue, 50);
});

test("paceColorRgb returns fresh arrays, never the palette itself", () => {
  const c = paceColorRgb(0);
  c[0] = 999;
  assert.deepEqual(paceColorRgb(0), [...PALETTE.green]); // unharmed
});
