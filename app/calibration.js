/**
 * Calibration: weighted tokens → estimated quota % (bogez/pace#13).
 * Implements docs/design/calibration.md exactly — read that first.
 *
 * Pure module: no storage, no DOM, no clock. The tracker owns persistence
 * (localStorage key pace.calibration.v1) and presentation.
 */
import { WEIGHTS, WEIGHTS_VERSION } from "../sensors/weights.mjs";

export const EMA_ALPHA = 0.5;
export const INSTABILITY_RATIO = 0.5;
export const LOG_CAP = 30;

/** Weighted-token total for raw component counts. */
export const weightedFromRaw = (raw, weights = WEIGHTS) =>
  (raw.input || 0) * weights.input +
  (raw.output || 0) * weights.output +
  (raw.cacheWrite || 0) * weights.cacheWrite +
  (raw.cacheRead || 0) * weights.cacheRead;

export const emptyCalibration = () => ({
  K: null, // weighted tokens per quota percent; null = never calibrated
  weightsVersion: WEIGHTS_VERSION,
  log: [], // { t, U, raw } — raw counts kept so K survives weight changes
});

/**
 * Record one calibration observation: the user typed U (real /usage %) while
 * the sensor's cumulative raw counts stood at `raw`.
 *
 * @returns {{ cal: object, accepted: boolean, unstable?: boolean, Kobs?: number }}
 *   unstable — the new observation deviates from remembered K by more than
 *   INSTABILITY_RATIO; K still updates, but the UI must say so
 *   (docs/design/calibration.md, "Confidence").
 */
export function observe(cal, { t, U, raw }, weights = WEIGHTS) {
  if (!(U > 0)) return { cal, accepted: false };
  const W = weightedFromRaw(raw, weights);
  if (!(W > 0)) return { cal, accepted: false };

  const Kobs = W / U;
  const unstable = cal.K != null && Math.abs(Kobs - cal.K) / cal.K > INSTABILITY_RATIO;
  const K = cal.K == null ? Kobs : EMA_ALPHA * Kobs + (1 - EMA_ALPHA) * cal.K;
  const log = [...cal.log, { t, U, raw }].slice(-LOG_CAP);
  return { cal: { ...cal, K, log }, accepted: true, unstable, Kobs };
}

/**
 * Estimated quota % for the current weighted total. Null when uncalibrated —
 * never invent a percent (the zero state shows raw tokens instead).
 */
export function estimatePct(cal, weightedNow) {
  if (cal?.K == null || !(weightedNow >= 0)) return null;
  return weightedNow / cal.K;
}

/**
 * Refit K from the log under new weights (provider pricing changed). The log
 * keeps raw counts precisely so this is a recompute, not a restart.
 */
export function recompute(cal, weights = WEIGHTS, weightsVersion = WEIGHTS_VERSION) {
  let K = null;
  for (const p of cal.log) {
    const W = weightedFromRaw(p.raw, weights);
    if (!(W > 0) || !(p.U > 0)) continue;
    const Kobs = W / p.U;
    K = K == null ? Kobs : EMA_ALPHA * Kobs + (1 - EMA_ALPHA) * K;
  }
  return { ...cal, K, weightsVersion };
}
