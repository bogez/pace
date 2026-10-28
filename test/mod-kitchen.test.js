/**
 * The Pace kitchen mod's pure half (apps/mod/lib/kitchen.js). The hooks are
 * tested by `claude plugin test` in apps/mod/tests; this suite runs in plain
 * node so CI covers the mapping and the art without Claude Code installed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOODS, FRAMES, W, H, COLORS, moodFor, moodForDelta, previewMood,
  caption, details, scene, rasterCells, svgFor,
} from "../apps/mod/lib/kitchen.js";
import { ZONES, paceState } from "../src/pace.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-10-01T12:00:00Z");
const week = (pct, hoursLeft) => ({
  kind: "seven_day",
  percentUsed: pct,
  resetsAt: new Date(NOW + hoursLeft * 36e5).toISOString(),
});

test("the mod ships an exact copy of the engine", () => {
  // An installed plugin is copied on its own, so it can't import ../../src.
  // Re-copy with: cp src/pace.js apps/mod/lib/pace.js
  assert.equal(
    readFileSync(join(root, "apps/mod/lib/pace.js"), "utf8"),
    readFileSync(join(root, "src/pace.js"), "utf8"),
    "apps/mod/lib/pace.js drifted from src/pace.js — cp src/pace.js apps/mod/lib/pace.js"
  );
});

test("plugin version tracks the app version", () => {
  const app = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const mod = JSON.parse(readFileSync(join(root, "apps/mod/.claude-plugin/plugin.json"), "utf8")).version;
  assert.equal(mod, app);
});

test("every pace state has exactly one mood, and the mood is just the state", () => {
  const deltas = [-60, -ZONES.cold.teal - 1, -10, 0, ZONES.green + 1, ZONES.hot.yellow + 1, ZONES.hot.red + 1];
  for (const d of deltas) {
    const m = moodForDelta(d);
    assert.equal(MOODS[m.mood].state, paceState(d).name, `delta ${d}`);
  }
  const states = Object.values(MOODS).map((m) => m.state).filter(Boolean);
  assert.equal(new Set(states).size, states.length);
});

test("moodFor: half the week gone, half used → in the zone", () => {
  const m = moodFor([week(50, 84)], NOW);
  assert.equal(m.mood, "zone");
  assert.equal(m.elapsedPct, 50);
  assert.equal(caption(m), "● in the zone — cooking perfectly");
  assert.equal(details(m), "week 50% used · 50% of the week gone");
});

test("moodFor: far ahead burns, far behind is cold", () => {
  assert.equal(moodFor([week(90, 84)], NOW).mood, "burning");
  assert.equal(moodFor([week(5, 84)], NOW).mood, "cold");
});

test("moodFor refuses readings it can't place in the week", () => {
  assert.equal(moodFor([], NOW).mood, "idle");
  assert.equal(moodFor([{ kind: "five_hour", percentUsed: 40 }], NOW).mood, "idle");
  assert.equal(moodFor([{ kind: "seven_day", percentUsed: 40 }], NOW).mood, "idle"); // no reset
  assert.equal(moodFor([week(40, -1)], NOW).mood, "idle"); // reset already passed
  assert.equal(moodFor([week(40, 200)], NOW).mood, "idle"); // more than a week out
});

test("captions always lead with the glyph and state name (never color alone)", () => {
  for (const mood of Object.keys(MOODS).filter((k) => k !== "idle")) {
    const m = previewMood(mood);
    assert.ok(caption(m).startsWith(`${m.glyph} ${m.name} — `), caption(m));
  }
});

test("every mood and frame draws a full grid in palette colors only", () => {
  for (const mood of Object.keys(MOODS)) {
    for (let f = 0; f < FRAMES; f++) {
      const g = scene(mood, f);
      assert.equal(g.length, H);
      for (const row of g) {
        assert.equal(row.length, W);
        for (const c of row) assert.ok(c === "." || c in COLORS, `${mood}/${f}: unknown pixel ${c}`);
      }
    }
  }
});

test("frames actually animate", () => {
  for (const mood of Object.keys(MOODS)) {
    const frames = new Set(Array.from({ length: FRAMES }, (_, f) => scene(mood, f).flat().join("")));
    assert.ok(frames.size > 1, `${mood} is a still life`);
  }
});

test("terminal raster: W columns × H/2 rows of u32 triplets", () => {
  const r = rasterCells(scene("zone", 0));
  assert.equal(r.columns, W);
  assert.equal(r.rows, H / 2);
  assert.equal(Buffer.from(r.cells, "base64").length, W * (H / 2) * 3 * 4);
});

test("desktop svg fits the Svg element's 131,072-character limit", () => {
  for (const mood of Object.keys(MOODS)) {
    const svg = svgFor(mood);
    assert.ok(svg.length < 131072, `${mood}: ${svg.length} chars`);
    assert.equal((svg.match(/<animate /g) || []).length, FRAMES);
    assert.ok(!/<script|on\w+=/i.test(svg));
  }
});
