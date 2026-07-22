/**
 * Sensor parser suite (bogez/pace#11): pins the transcript-format knowledge
 * against committed synthetic fixtures. These fixtures are also the contract
 * the tray app's Rust port (#15) must match exactly.
 *
 * Fixture arithmetic (weights v1: input×1, output×5, cacheW×1.25, cacheR×0.1):
 *   msg_001 (Jul 18, sonnet): 1000 + 200×5 + 400×1.25 + 10000×0.1 = 3500
 *     — appears twice (streaming rewrite), counted once
 *   msg_002 (Jul 14, haiku): before weekStart — excluded
 *   msg_003 (Jul 21 08:30, sonnet): 2000 + 100×5 = 2500 — inside session window
 *   msg_004 (Jul 20, opus): 1000×5 = 5000
 *   req_9  (Jul 19, no message.id, no model): 100 — duplicated line, counted
 *     once via the requestId+timestamp fallback key
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscripts, zeroAgg } from "../sensors/parse-transcripts.mjs";
import { WEIGHTS } from "../sensors/weights.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "claude-code");
const texts = ["week-main.jsonl", "week-other.jsonl"].map((f) =>
  readFileSync(join(dir, f), "utf8")
);

const weekStart = new Date("2026-07-16T05:00:00.000Z");
const sessionStart = new Date("2026-07-21T07:00:00.000Z");
const run = () => parseTranscripts(texts, { weekStart, sessionStart });

test("weekly totals: dedup, window filter, and weighting all at once", () => {
  const { week, events } = run();
  assert.equal(events, 4); // msg_001, msg_003, msg_004, req_9 — nothing else
  assert.equal(week.input, 3100);
  assert.equal(week.output, 1300);
  assert.equal(week.cacheWrite, 400);
  assert.equal(week.cacheRead, 10000);
  assert.equal(week.weighted, 11100);
  assert.equal(week.count, 4);
});

test("streaming duplicates collapse by message.id", () => {
  // msg_001 appears twice in the fixture; its 3500 weighted counts once.
  const { hourly } = run();
  assert.equal(hourly["2026-07-18T10"], 3500);
});

test("duplicate lines without message.id collapse by requestId+timestamp", () => {
  const { hourly } = run();
  assert.equal(hourly["2026-07-19T12"], 100);
});

test("events before the window are excluded even with valid usage", () => {
  const { byModel } = run();
  assert.equal(byModel["claude-haiku-4-5"], undefined); // msg_002 only
});

test("session window is a subset of the week", () => {
  const { session } = run();
  assert.equal(session.count, 1); // only msg_003
  assert.equal(session.weighted, 2500);
});

test("per-model attribution, unknown model bucketed", () => {
  const { byModel } = run();
  assert.equal(byModel["claude-sonnet-5"].count, 2);
  assert.equal(byModel["claude-sonnet-5"].weighted, 6000);
  assert.equal(byModel["claude-opus-4-8"].weighted, 5000);
  assert.equal(byModel.unknown.weighted, 100);
});

test("malformed lines, non-assistant records, and usage-less messages are skipped silently", () => {
  // The fixture contains a broken JSON line, a user record, and an assistant
  // record with no usage — if any of them threw or counted, totals above
  // would differ. This pins the tolerance explicitly:
  assert.doesNotThrow(run);
});

test("weights are injectable (calibration model can recompute history)", () => {
  const flat = { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 };
  const { week } = parseTranscripts(texts, { weekStart, sessionStart, weights: flat });
  assert.equal(week.weighted, 3100 + 1300 + 400 + 10000);
});

test("empty input yields clean zeros", () => {
  const { week, session, events, byModel } = parseTranscripts([], { weekStart });
  assert.deepEqual(week, zeroAgg());
  assert.deepEqual(session, zeroAgg());
  assert.equal(events, 0);
  assert.deepEqual(byModel, {});
});

test("weights v1 are the documented values", () => {
  assert.deepEqual(WEIGHTS, { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 });
});

test("output matches expected.json — the cross-implementation contract", () => {
  // The Rust port (apps/tray/sensor-rs, docs/design/tray-sensor.md) is pinned
  // to the same file by its parity suite. Regenerate deliberately via
  // scripts/gen-expected.mjs; a diff here is a contract change.
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
  assert.deepEqual(expected.files, ["week-main.jsonl", "week-other.jsonl"]);
  assert.equal(Date.parse(expected.weekStart), weekStart.getTime());
  assert.equal(Date.parse(expected.sessionStart), sessionStart.getTime());
  assert.deepEqual(run(), expected.result);
});
