/**
 * Token weights: approximate quota cost per token kind, mirroring API price
 * relatives (cache reads dominate raw counts but cost almost nothing).
 * Versioned per docs/design/calibration.md — stored calibrations are tagged
 * with WEIGHTS_VERSION, and the calibration log keeps raw component counts so
 * a version bump recomputes history instead of starting blind.
 */
export const WEIGHTS_VERSION = 1;

export const WEIGHTS = Object.freeze({
  input: 1,
  output: 5,
  cacheWrite: 1.25,
  cacheRead: 0.1,
});
