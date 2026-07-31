/**
 * Measured usage from Claude Code's statusline JSON (bogez/pace#51).
 * Implements docs/design/measured-usage.md — read that first.
 *
 * Claude Code passes JSON to the user's configured statusline script; for
 * Pro/Max subscribers it carries rate_limits.{five_hour,seven_day} with
 * used_percentage (0–100) and resets_at (epoch seconds) — the exact numbers
 * /usage shows (https://code.claude.com/docs/en/statusline). This module
 * parses either that raw stdin document or the file the statusline bridge
 * (sensors/statusline.mjs) tees to disk.
 *
 * Pure module: no storage, no DOM, no clock — the caller supplies `now`.
 * The tracker owns persistence (localStorage key pace.measured.v1).
 */

/** Epoch normalizer: the statusline docs specify seconds; tolerate ms. */
const toMs = (v) => (Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : null);

/** One window's reading, or null when absent/unusable. */
function windowReading(w) {
  if (!w || typeof w !== "object") return null;
  const pct = w.used_percentage;
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return { pct, resetsAt: toMs(w.resets_at) };
}

/**
 * Parse a measured-usage document. Returns
 *   { t, weekly: {pct, resetsAt}|null, session: {pct, resetsAt}|null }
 * or null when the document isn't measured-usage shaped (no usable
 * rate_limits). The two windows can be independently absent, per the
 * statusline docs. `t` is the bridge's generatedAt stamp when present,
 * else `nowMs` — a raw statusline paste has no timestamp of its own, so
 * we take it as freshly produced.
 */
export function parseMeasured(d, nowMs) {
  const rl = d?.rate_limits;
  if (!rl || typeof rl !== "object") return null;
  const weekly = windowReading(rl.seven_day);
  const session = windowReading(rl.five_hour);
  if (!weekly && !session) return null;
  const stamped = Date.parse(d.generatedAt);
  return { t: Number.isFinite(stamped) ? stamped : nowMs, weekly, session };
}
