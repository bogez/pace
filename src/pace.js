/**
 * pace — the pace engine.
 *
 * Turns "usage % + position in the billing window" into a single pace delta,
 * a color, and a human-readable state. Provider-agnostic: feed it any quota
 * (Claude weekly, ChatGPT, an API budget) and any window length.
 *
 * delta = actual% − expected%, where expected = (elapsed / window) × 100.
 *   delta ≈ 0  → in the zone (green)
 *   delta > 0  → burning too fast (→ red, ramps fast: overuse gets you cut off)
 *   delta < 0  → headroom (→ blue, ramps slow: underuse is not a crisis)
 *
 * Zone boundaries and colors are exported as data (ZONES, PALETTE) and defined
 * nowhere else — shells import them instead of re-declaring literals, so a
 * tuning change happens in exactly one place (bogez/pace#3). The asymmetry
 * (full red at +25, full blue at −50) is deliberate: overuse and underuse are
 * not morally equivalent. Changing any boundary takes an issue, not a whim
 * (charter principle 5).
 */

/**
 * Zone boundaries, in pace-delta percentage points. The single source of truth.
 *
 *   |delta| ≤ green ......................... in the zone
 *   green < delta ≤ hot.yellow .............. warm (green → yellow ramp)
 *   hot.yellow < delta ≤ hot.red ............ running hot (yellow → red ramp)
 *   delta > hot.red ......................... overheating (full red)
 *   −cold.teal ≤ delta < −green ............. cool (green → teal ramp)
 *   −cold.blue ≤ delta < −cold.teal ......... cold (teal → blue ramp)
 *   delta < −cold.blue ...................... deep-blue floor
 */
export const ZONES = Object.freeze({
  green: 5,
  hot: Object.freeze({ yellow: 15, red: 25 }),
  cold: Object.freeze({ teal: 25, blue: 50 }),
});

/** Anchor colors as [r, g, b]. Ramps between them are linear (see paceColorRgb). */
export const PALETTE = Object.freeze({
  green: Object.freeze([12, 163, 12]),
  yellow: Object.freeze([250, 178, 25]),
  red: Object.freeze([208, 59, 59]),
  teal: Object.freeze([53, 162, 79]),
  blue: Object.freeze([57, 135, 229]),
  deepBlue: Object.freeze([28, 92, 171]),
});

/**
 * Pace delta in percentage points. Positive = hot, negative = cold.
 *
 * @param {number} usagePct - usage shown by the provider, 0–100
 * @param {number} elapsed - time since the window started (any unit)
 * @param {number} window - total window length (same unit as elapsed)
 * @returns {number} usagePct − expected%
 * @throws {RangeError} when window ≤ 0 or elapsed < 0
 */
export function paceDelta(usagePct, elapsed, window) {
  if (window <= 0) throw new RangeError("window must be > 0");
  // Negative elapsed is a caller bug (a clock went backwards, a reset was
  // mis-set). Refuse rather than extrapolate: a confident wrong answer is
  // worse than an error (charter principle 3). Decided in bogez/pace#4.
  if (elapsed < 0) throw new RangeError("elapsed must be >= 0");
  return usagePct - (elapsed / window) * 100;
}

const lerp = (t, a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/**
 * Map a delta to an [r, g, b] color.
 * Asymmetric by design: full red at +ZONES.hot.red (25), full blue at
 * −ZONES.cold.blue (−50) — see the module header for why.
 *
 * @param {number} delta - pace delta from paceDelta()
 * @returns {number[]} a fresh [r, g, b] array
 */
export function paceColorRgb(delta) {
  const { green, hot, cold } = ZONES;
  if (delta >= 0) {
    if (delta <= green) return [...PALETTE.green];
    if (delta <= hot.yellow)
      return lerp((delta - green) / (hot.yellow - green), PALETTE.green, PALETTE.yellow);
    if (delta <= hot.red)
      return lerp((delta - hot.yellow) / (hot.red - hot.yellow), PALETTE.yellow, PALETTE.red);
    return [...PALETTE.red];
  }
  const d = -delta;
  if (d <= green) return [...PALETTE.green];
  if (d <= cold.teal)
    return lerp((d - green) / (cold.teal - green), PALETTE.green, PALETTE.teal);
  if (d <= cold.blue)
    return lerp((d - cold.teal) / (cold.blue - cold.teal), PALETTE.teal, PALETTE.blue);
  return [...PALETTE.deepBlue];
}

/**
 * CSS convenience wrapper.
 * @param {number} delta
 * @returns {string} e.g. "rgb(12,163,12)"
 */
export const paceColor = (delta) => `rgb(${paceColorRgb(delta).join(",")})`;

/**
 * Named state + direction glyph — the colorblind-safe channel (charter
 * principle 2: never color alone). Glyphs: ▲▲ hot, ▲ warm, ● in the zone,
 * ▼ cool, ▼▼ cold.
 *
 * @param {number} delta - pace delta from paceDelta()
 * @returns {{ name: string, glyph: string }}
 */
export function paceState(delta) {
  if (delta > ZONES.hot.red) return { name: "overheating", glyph: "▲▲" };
  if (delta > ZONES.hot.yellow) return { name: "running hot", glyph: "▲▲" };
  if (delta > ZONES.green) return { name: "warm", glyph: "▲" };
  if (delta >= -ZONES.green) return { name: "in the zone", glyph: "●" };
  if (delta >= -ZONES.cold.teal) return { name: "cool", glyph: "▼" };
  return { name: "cold", glyph: "▼▼" };
}

/**
 * Project forward assuming the average burn rate so far continues.
 * Linear extrapolation is deliberate — it was good enough in prototype
 * testing, and it's explainable in one sentence.
 * Returns null when there's nothing to extrapolate from.
 *
 * @param {number} usagePct - usage shown by the provider, 0–100
 * @param {number} elapsed - time since the window started (any unit)
 * @param {number} window - total window length (same unit as elapsed)
 * @returns {{ projectedPct: number, runsOut: boolean, unitsToExhaustion: number } | null}
 *   projectedPct — usage % at window end at current pace
 *   runsOut — true if 100% is hit before the window resets
 *   unitsToExhaustion — time (same unit as elapsed/window) until 100%
 */
export function forecast(usagePct, elapsed, window) {
  if (elapsed <= 0 || usagePct <= 0) return null;
  const rate = usagePct / elapsed;
  const unitsToExhaustion = usagePct >= 100 ? 0 : (100 - usagePct) / rate;
  return {
    projectedPct: rate * window,
    runsOut: elapsed + unitsToExhaustion < window,
    unitsToExhaustion,
  };
}
