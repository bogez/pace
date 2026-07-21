/**
 * Window math for the tracker: where are we in the billing window?
 *
 * Pure functions of (now, config) so they're unit-testable — no Date.now(),
 * no storage, no DOM. The weekly window is anchored to a local reset
 * day-of-week + hour (what /usage tells you, e.g. "resets Thursday 5 AM").
 */

export const WEEK_HOURS = 168;
export const SESSION_HOURS = 5;

/**
 * The most recent weekly reset at or before `now`.
 *
 * @param {Date} now
 * @param {number} resetDow - reset day of week, 0 = Sunday … 6 = Saturday
 * @param {number} resetHour - local hour of the reset, 0–23
 * @returns {Date}
 */
export function lastWeeklyReset(now, resetDow, resetHour) {
  const d = new Date(now);
  d.setHours(resetHour, 0, 0, 0);
  const diff = (d.getDay() - resetDow + 7) % 7;
  d.setDate(d.getDate() - diff);
  if (d > now) d.setDate(d.getDate() - 7);
  return d;
}

/**
 * Hours between two instants (fractional, ≥ 0 when b is after a).
 * @param {Date} a
 * @param {Date} b
 */
export const hoursBetween = (a, b) => (b - a) / 36e5;

/**
 * Position in the current weekly window.
 *
 * @param {Date} now
 * @param {number} resetDow
 * @param {number} resetHour
 * @returns {{ start: Date, elapsedHours: number, elapsedPct: number }}
 */
export function weeklyWindow(now, resetDow, resetHour) {
  const start = lastWeeklyReset(now, resetDow, resetHour);
  const elapsedHours = hoursBetween(start, now);
  return { start, elapsedHours, elapsedPct: (elapsedHours / WEEK_HOURS) * 100 };
}

/**
 * Position in a 5-hour session window given when /usage says it resets.
 * Returns null when the stated reset is already past (the session rolled
 * over — yesterday's number means nothing now) or is more than a session
 * length away (bad input).
 *
 * @param {Date} now
 * @param {Date} resetsAt - when the current session window ends
 * @returns {{ elapsedHours: number } | null}
 */
export function sessionWindow(now, resetsAt) {
  const remaining = hoursBetween(now, resetsAt);
  if (remaining <= 0 || remaining > SESSION_HOURS) return null;
  return { elapsedHours: SESSION_HOURS - remaining };
}

/**
 * Staleness tiers for a check-in's age (bogez/pace#9, design agreed
 * in-thread). Derived from expected-pace drift (~0.6 points/hour in a
 * weekly window): under 12 h the color is still meaningful; by 24 h it
 * could be a full zone off; beyond that it's a labeled guess.
 * Boundary values belong to the milder tier, matching the engine's zone
 * convention.
 */
export const FRESH_MAX_HOURS = 12;
export const AGING_MAX_HOURS = 24;

/**
 * @param {number} ageHours - hours since the last check-in
 * @returns {"fresh" | "aging" | "stale"}
 */
export function stalenessTier(ageHours) {
  if (ageHours <= FRESH_MAX_HOURS) return "fresh";
  if (ageHours <= AGING_MAX_HOURS) return "aging";
  return "stale";
}
