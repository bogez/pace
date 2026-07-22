/**
 * Tauri bridge (bogez/pace#16): the only file that knows the tray app exists.
 * In a plain browser (`window.__TAURI__` absent) this module does nothing —
 * the PWA stays byte-for-byte the same product.
 *
 * Two duties, both thin:
 * 1. Auto-refresh: periodically invoke the in-process Rust sensor
 *    (docs/design/tray-sensor.md) and feed its output through the exact same
 *    import path as a manual paste — one code path, one honesty model.
 * 2. Drive the dot: forward the tracker's `pace:reading` events (composed by
 *    tray-format.js) to the `set_tray` command.
 *
 * Windows and weights are computed HERE, in JS, from the same modules the
 * page uses — Rust only enumerates, reads, and counts (everything testable
 * lives in JS, #16 acceptance criteria).
 */
import { weeklyWindow, SESSION_HOURS } from "./window.js";
import { WEIGHTS, WEIGHTS_VERSION } from "../sensors/weights.mjs";

const REFRESH_MINUTES = 5;
const tauri = globalThis.__TAURI__;

if (tauri) {
  let lastTray = "";
  addEventListener("pace:reading", (e) => {
    const key = JSON.stringify(e.detail);
    if (key === lastTray) return; // the 30 s tick re-renders; the dot only repaints on change
    lastTray = key;
    const [r, g, b] = e.detail.rgb;
    tauri.core.invoke("set_tray", { r, g, b, tooltip: e.detail.tooltip });
  });

  const refresh = async () => {
    // The tracker owns pace.tracker.v1; read only the reset config from it,
    // falling back to its own defaults (app/tracker.js).
    let resetDow = 4,
      resetHour = 5;
    try {
      const s = JSON.parse(localStorage.getItem("pace.tracker.v1"));
      if (Number.isFinite(s?.resetDow)) resetDow = s.resetDow;
      if (Number.isFinite(s?.resetHour)) resetHour = s.resetHour;
    } catch {
      /* defaults hold */
    }
    const now = new Date();
    const win = weeklyWindow(now, resetDow, resetHour);
    try {
      const result = await tauri.core.invoke("read_sensor", {
        weekStartMs: win.start.getTime(),
        // rolling approximation, same as the CLI wrapper
        sessionStartMs: now.getTime() - SESSION_HOURS * 3600e3,
        weights: WEIGHTS,
      });
      // Shape the aggregate like the CLI's --json so the tracker's import
      // path (and its validation) applies unchanged.
      const doc = {
        generatedAt: now.toISOString(),
        weightsVersion: WEIGHTS_VERSION,
        window: { weekStart: win.start.toISOString() },
        ...result,
      };
      dispatchEvent(new CustomEvent("pace:sensor-json", { detail: JSON.stringify(doc) }));
    } catch {
      // Sensor failure is not a UI failure: the page keeps rendering the last
      // known state with its own staleness honesty.
    }
  };

  refresh();
  setInterval(refresh, REFRESH_MINUTES * 60_000);
}
