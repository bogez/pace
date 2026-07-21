/**
 * Calibration model suite (bogez/pace#13) — pins docs/design/calibration.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  observe,
  estimatePct,
  recompute,
  emptyCalibration,
  weightedFromRaw,
  EMA_ALPHA,
  LOG_CAP,
} from "../app/calibration.js";

// raw counts whose v1 weighted total is exactly 3,000,000:
// 1,000,000×1 + 300,000×5 + 400,000×1.25 + 0×0.1
const RAW_3M = { input: 1_000_000, output: 300_000, cacheWrite: 400_000, cacheRead: 0 };

test("weighted math matches the sensor's (single set of weights)", () => {
  assert.equal(weightedFromRaw(RAW_3M), 3_000_000);
});

test("first observation sets K directly", () => {
  const { cal, accepted, unstable } = observe(emptyCalibration(), { t: 1, U: 50, raw: RAW_3M });
  assert.equal(accepted, true);
  assert.equal(unstable, false);
  assert.equal(cal.K, 60_000); // 3M / 50%
  assert.equal(cal.log.length, 1);
});

test("subsequent observations blend by EMA", () => {
  let { cal } = observe(emptyCalibration(), { t: 1, U: 50, raw: RAW_3M });
  // Same tokens now claimed to be 75% → Kobs = 40,000; EMA(½) → 50,000
  ({ cal } = observe(cal, { t: 2, U: 75, raw: RAW_3M }));
  assert.equal(cal.K, EMA_ALPHA * 40_000 + (1 - EMA_ALPHA) * 60_000);
});

test("instability flag: >50% deviation is reported, not silently averaged", () => {
  let { cal } = observe(emptyCalibration(), { t: 1, U: 50, raw: RAW_3M });
  const r = observe(cal, { t: 2, U: 10, raw: RAW_3M }); // Kobs 300,000 vs K 60,000
  assert.equal(r.unstable, true);
  assert.ok(r.cal.K > 60_000); // still updates — the flag is the honesty channel
});

test("estimate is null when uncalibrated: never invent a percent", () => {
  assert.equal(estimatePct(emptyCalibration(), 5_000_000), null);
  const { cal } = observe(emptyCalibration(), { t: 1, U: 50, raw: RAW_3M });
  assert.equal(estimatePct(cal, 3_600_000), 60); // 3.6M / 60k per %
});

test("rejects unusable observations", () => {
  const cal = emptyCalibration();
  assert.equal(observe(cal, { t: 1, U: 0, raw: RAW_3M }).accepted, false);
  assert.equal(observe(cal, { t: 1, U: 50, raw: { input: 0 } }).accepted, false);
});

test("log caps and keeps the newest entries", () => {
  let cal = emptyCalibration();
  for (let i = 1; i <= LOG_CAP + 5; i++) {
    ({ cal } = observe(cal, { t: i, U: 50, raw: RAW_3M }));
  }
  assert.equal(cal.log.length, LOG_CAP);
  assert.equal(cal.log.at(-1).t, LOG_CAP + 5);
});

test("recompute refits K from raw history under new weights", () => {
  let { cal } = observe(emptyCalibration(), { t: 1, U: 50, raw: RAW_3M });
  const flat = { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 }; // pretend v2
  const re = recompute(cal, flat, 2);
  assert.equal(re.weightsVersion, 2);
  assert.equal(re.K, 1_700_000 / 50); // flat-weighted total / same U
  assert.equal(re.log.length, 1); // history preserved
});
