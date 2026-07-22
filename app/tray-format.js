/**
 * Tray-dot presentation: pure mapping from a reading to the dot's RGB and
 * tooltip (bogez/pace#16). Lives outside tray.js so it is unit-testable in
 * node — the Tauri bridge itself is a thin, untestable DOM/IPC edge.
 *
 * Honesty on 16 pixels (charter principles 2 & 3):
 * - never color alone — the tooltip always carries the glyph and state words
 * - estimated readings are marked "≈ … (estimated)" (TRUST.md commitment 5)
 * - stale readings desaturate the dot toward gray and say "probably" — the
 *   same degradation grammar as the page (#9)
 */
import { paceDelta, paceColorRgb, paceState } from "../src/pace.js";
import { stalenessTier, hoursBetween, WEEK_HOURS } from "./window.js";

/** The no-data gray, also the shell's boot color (src-tauri/src/lib.rs). */
export const GRAY = Object.freeze([137, 135, 129]);

/**
 * @param {{ pct: number, t: number, estimated: boolean } | null} reading -
 *   the tracker's current reading (freshest of check-in / calibrated estimate)
 * @param {{ start: Date, elapsedHours: number, elapsedPct: number }} win
 * @param {Date} now
 * @returns {{ rgb: number[], tooltip: string }}
 */
export function trayState(reading, win, now) {
  if (!reading) {
    return { rgb: [...GRAY], tooltip: "Pace ● no data yet — open the popover to check in" };
  }
  const delta = paceDelta(reading.pct, win.elapsedHours, WEEK_HOURS);
  const st = paceState(delta);
  const tier = stalenessTier(hoursBetween(new Date(reading.t), now));
  let rgb = paceColorRgb(delta);
  // Stale: degrade every channel, not just words — halfway to gray mirrors
  // the page's desaturated dot.
  if (tier === "stale") rgb = rgb.map((v, i) => Math.round((v + GRAY[i]) / 2));

  const name = tier === "stale" ? `probably ${st.name}` : st.name;
  const pct = reading.estimated
    ? `≈${reading.pct.toFixed(0)}% used (estimated)`
    : `${reading.pct}% used`;
  const staleness =
    tier === "fresh" ? "" : " · data is getting old — check /usage";
  return {
    rgb,
    tooltip:
      `Pace ${st.glyph} ${name} — ${pct}, ` +
      `${win.elapsedPct.toFixed(0)}% of the week elapsed${staleness}`,
  };
}
