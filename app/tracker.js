/**
 * Pace tracker (bogez/pace#5, #13): manual /usage check-ins → live color,
 * plus sensor-derived estimates with honest calibration.
 *
 * All pace math comes from the engine; window math from window.js;
 * calibration math from calibration.js (docs/design/calibration.md).
 * This file is only wiring: storage, forms, and rendering. It makes no
 * network calls and never will (TRUST.md commitment 2).
 *
 * Measured vs. estimated (TRUST.md commitment 5): the meter uses the sensor
 * estimate only when it is newer than the last manual check-in, and then it
 * says so on every channel — dashed dot outline, "≈" on the number, and a
 * source line naming the sensor. A manual check-in always wins instantly.
 */
import { paceDelta, paceColor, paceState, forecast } from "../src/pace.js";
import { weeklyWindow, sessionWindow, stalenessTier, hoursBetween, WEEK_HOURS, SESSION_HOURS } from "./window.js";
import { observe, estimatePct, recompute, emptyCalibration, weightedFromRaw } from "./calibration.js";
import { WEIGHTS_VERSION } from "../sensors/weights.mjs";
import { trayState } from "./tray-format.js";

/* ---------------- storage ---------------- */

const KEY = "pace.tracker.v1";
const CAL_KEY = "pace.calibration.v1";
const SENSOR_KEY = "pace.sensor.v1";
// A check-in calibrates only if the sensor snapshot is close enough in time
// that W and U describe the same moment. 3 h keeps drift under a few percent
// at typical burn rates; recorded here, debatable in #13.
const CALIBRATION_PAIRING_HOURS = 3;

const defaults = () => ({
  resetDow: 4, // Thursday — a common Claude weekly reset; changeable in setup
  resetHour: 5,
  checkins: [], // { t: epoch ms, weeklyPct }
  session: null, // { pct, resetsAt: epoch ms }
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
  } catch {
    return defaults();
  }
}
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

const loadJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const saveJson = (key, v) => localStorage.setItem(key, JSON.stringify(v));

let state = load();
let cal = loadJson(CAL_KEY, emptyCalibration());
let sensor = loadJson(SENSOR_KEY, null); // { t, windowStart, raw, weighted }

// Provider pricing changed since this calibration was stored → refit from the
// raw log instead of starting blind (docs/design/calibration.md).
if (cal.weightsVersion !== WEIGHTS_VERSION) {
  cal = recompute(cal);
  saveJson(CAL_KEY, cal);
}

/* ---------------- els ---------------- */

const $ = (id) => document.getElementById(id);
const els = {
  dot: $("dot"),
  glyph: $("glyph"),
  stateName: $("state-name"),
  deltaLine: $("delta-line"),
  forecastLine: $("forecast-line"),
  ageLine: $("age-line"),
  checkinForm: $("checkin-form"),
  weeklyPct: $("weekly-pct"),
  sessionForm: $("session-form"),
  sessionPct: $("session-pct"),
  sessionResets: $("session-resets"),
  sessionLine: $("session-line"),
  sourceLine: $("source-line"),
  sensorPaste: $("sensor-paste"),
  sensorFile: $("sensor-file"),
  sensorImport: $("sensor-import"),
  sensorLine: $("sensor-line"),
  resetDow: $("reset-dow"),
  resetHour: $("reset-hour"),
  setup: $("setup"),
  historyCard: $("history-card"),
  history: $("history"),
  clear: $("clear-data"),
};

/* ---------------- helpers ---------------- */

const fmtDelta = (d) =>
  `${d > 0 ? "+" : ""}${d.toFixed(1)} points vs. expected pace`;

const fmtHours = (h) => {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} days`;
};

const fmtWhen = (t) =>
  new Date(t).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * Set text only when it changed: the meter is an aria-live region, and
 * rewriting identical text on the 30 s tick would make screen readers
 * re-announce a state that hasn't moved (#8).
 */
const setText = (el, s) => {
  if (el.textContent !== s) el.textContent = s;
};

/**
 * The sensor estimate to display, or null. Requirements: a calibration
 * exists, the snapshot is inside the current window, and the snapshot is
 * newer than the last manual check-in (a manual check-in always wins —
 * it is ground truth).
 */
function currentEstimate(win, checkin) {
  if (!sensor || cal.K == null) return null;
  if (sensor.t < win.start.getTime()) return null;
  if (checkin && checkin.t >= sensor.t) return null;
  const pct = estimatePct(cal, sensor.weighted);
  if (pct == null) return null;
  return { pct: Math.min(pct, 100), t: sensor.t };
}

/** Latest check-in belonging to the current window, or null. */
function currentCheckin(win) {
  const last = state.checkins.at(-1);
  if (!last) return null;
  return last.t >= win.start.getTime() ? last : null;
}

/* ---------------- render ---------------- */

function render() {
  const now = new Date();
  const win = weeklyWindow(now, state.resetDow, state.resetHour);
  const checkin = currentCheckin(win);
  const est = currentEstimate(win, checkin);
  // The freshest of (manual check-in, calibrated sensor estimate) drives the
  // meter; `estimated` flags which one won.
  const reading = est
    ? { pct: est.pct, t: est.t, estimated: true }
    : checkin
      ? { pct: checkin.weeklyPct, t: checkin.t, estimated: false }
      : null;

  if (!reading) {
    els.dot.style.background = "";
    setText(els.glyph, "●");
    setText(els.stateName, "no data yet");
    setText(
      els.deltaLine,
      state.checkins.length === 0
        ? `You're ${win.elapsedPct.toFixed(0)}% through the week. Log a check-in to get a color.`
        : "Your week reset since the last check-in — log a fresh one."
    );
    setText(els.forecastLine, "");
    setText(els.sourceLine, "");
    setText(els.ageLine, "");
    els.dot.classList.remove("stale", "estimated");
    els.setup.open = state.checkins.length === 0;
  } else {
    const delta = paceDelta(reading.pct, win.elapsedHours, WEEK_HOURS);
    const st = paceState(delta);
    const age = hoursBetween(new Date(reading.t), now);
    const tier = stalenessTier(age);

    els.dot.style.background = paceColor(delta);
    // Stale: every channel degrades, not just color — desaturated dot,
    // "probably" in the words, qualified forecast (#9, charter principle 3).
    els.dot.classList.toggle("stale", tier === "stale");
    // Estimated: dashed outline + "≈" + source line (TRUST.md commitment 5).
    els.dot.classList.toggle("estimated", reading.estimated);
    setText(els.glyph, st.glyph);
    setText(els.stateName, tier === "stale" ? `probably ${st.name}` : st.name);
    const pctLabel = reading.estimated
      ? `≈${reading.pct.toFixed(0)}% used (estimated)`
      : `${reading.pct}% used`;
    setText(
      els.deltaLine,
      `${pctLabel}, ${win.elapsedPct.toFixed(0)}% of the week elapsed — ${fmtDelta(delta)}`
    );
    setText(
      els.sourceLine,
      reading.estimated
        ? "Estimated from the Claude Code sensor + your calibration — log a check-in to correct it."
        : ""
    );

    const f = forecast(reading.pct, win.elapsedHours, WEEK_HOURS);
    if (!f) {
      setText(els.forecastLine, "");
    } else if (f.runsOut) {
      const short = WEEK_HOURS - win.elapsedHours - f.unitsToExhaustion;
      setText(
        els.forecastLine,
        `At your average pace you hit 100% about ${fmtHours(short)} before the reset.`
      );
    } else {
      setText(
        els.forecastLine,
        `At your average pace you'd end the week at ${Math.round(f.projectedPct)}% — ` +
          (f.projectedPct < 85 ? "you can afford to push." : "cutting it close.")
      );
    }
    if (f && tier === "stale") {
      setText(
        els.forecastLine,
        els.forecastLine.textContent +
          ` (Based on ${reading.estimated ? "a sensor snapshot" : "a check-in"} ${fmtHours(age)} ago.)`
      );
    }

    const what = reading.estimated ? "Sensor snapshot" : "Checked in";
    setText(
      els.ageLine,
      tier === "fresh"
        ? `${what} ${fmtHours(age)} ago.`
        : tier === "aging"
          ? `◌ ${what} ${fmtHours(age)} ago — worth a fresh look at /usage.`
          : `◌ ${what} ${fmtHours(age)} ago — this color is a guess until you check /usage.`
    );
  }

  renderSession(now);
  renderSensor(now, win);
  renderHistory(win);

  // The tray bridge (app/tray.js) listens for this; in a plain browser
  // nothing does and the event evaporates.
  dispatchEvent(new CustomEvent("pace:reading", { detail: trayState(reading, win, now) }));
}

function renderSession(now) {
  if (!state.session) {
    els.sessionLine.textContent = "";
    return;
  }
  const sw = sessionWindow(now, new Date(state.session.resetsAt));
  if (!sw) {
    // The stated session ended — yesterday's number means nothing now.
    state.session = null;
    save();
    els.sessionLine.textContent = "";
    return;
  }
  const delta = paceDelta(state.session.pct, sw.elapsedHours, SESSION_HOURS);
  const st = paceState(delta);
  // Color rides on a swatch, never on the text — colored text can't hold AA
  // contrast across the whole ramp, and the words must stay readable (#8).
  const swatch = document.createElement("span");
  swatch.className = "swatch";
  swatch.style.background = paceColor(delta);
  els.sessionLine.replaceChildren(
    swatch,
    ` ${st.glyph} ${st.name} — ${state.session.pct}% used, ` +
      `${fmtHours(SESSION_HOURS - sw.elapsedHours)} until the session resets`
  );
}

function renderSensor(now, win) {
  if (!sensor) {
    setText(els.sensorLine, "");
    return;
  }
  const M = (n) =>
    n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n));
  const age = fmtHours(hoursBetween(new Date(sensor.t), now));
  const inWindow = sensor.t >= win.start.getTime();
  if (!inWindow) {
    setText(els.sensorLine, `Last snapshot (${age} ago) is from before your week reset — import a fresh one.`);
    return;
  }
  const pct = estimatePct(cal, sensor.weighted);
  setText(
    els.sensorLine,
    pct == null
      ? // The honest zero state: raw tokens, never an invented percent.
        `${M(sensor.weighted)} weighted tokens this week (snapshot ${age} ago). ` +
        `Log what /usage shows once to calibrate — then Pace can estimate your %.`
      : `${M(sensor.weighted)} weighted tokens ≈ ${Math.min(pct, 100).toFixed(0)}% (snapshot ${age} ago, ` +
        `calibrated from ${cal.log.length} check-in${cal.log.length === 1 ? "" : "s"}).`
  );
}

/** Parse and store sensor --json output. Returns an error string or null. */
function importSensorJson(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return "That doesn't parse as JSON — paste the exact --json output.";
  }
  const w = d?.week;
  if (!d?.generatedAt || !w || typeof w.weighted !== "number") {
    return "That JSON doesn't look like the sensor's output (missing generatedAt/week.weighted).";
  }
  const t = Date.parse(d.generatedAt);
  if (!Number.isFinite(t)) return "generatedAt isn't a valid timestamp.";
  sensor = {
    t,
    windowStart: Date.parse(d.window?.weekStart) || null,
    raw: {
      input: w.input || 0,
      output: w.output || 0,
      cacheWrite: w.cacheWrite || 0,
      cacheRead: w.cacheRead || 0,
    },
    weighted: w.weighted,
  };
  saveJson(SENSOR_KEY, sensor);
  return null;
}

function renderHistory(win) {
  const items = state.checkins.slice(-8).reverse();
  els.historyCard.hidden = items.length === 0;
  els.history.replaceChildren(
    ...items.map((c) => {
      const li = document.createElement("li");
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = fmtWhen(c.t) + (c.t < win.start.getTime() ? " (previous week)" : "");
      const what = document.createElement("span");
      what.textContent = `${c.weeklyPct}%`;
      li.append(when, what);
      return li;
    })
  );
}

/* ---------------- events ---------------- */

els.checkinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const pct = Number(els.weeklyPct.value);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
  const now = Date.now();
  state.checkins.push({ t: now, weeklyPct: pct });
  if (state.checkins.length > 100) state.checkins = state.checkins.slice(-100);
  save();

  // The calibration act (#13): a real /usage number paired with a recent
  // sensor snapshot teaches the scale factor. Only pair readings that
  // describe (nearly) the same moment.
  const win = weeklyWindow(new Date(now), state.resetDow, state.resetHour);
  let calibrationNote = null;
  if (
    sensor &&
    sensor.t >= win.start.getTime() &&
    hoursBetween(new Date(sensor.t), new Date(now)) <= CALIBRATION_PAIRING_HOURS
  ) {
    const r = observe(cal, { t: now, U: pct, raw: sensor.raw });
    if (r.accepted) {
      cal = r.cal;
      saveJson(CAL_KEY, cal);
      calibrationNote = r.unstable
        ? "⚠ Calibration updated, but this reading disagrees strongly with earlier ones — " +
          "if the next one does too, your usage mix may have changed."
        : "Calibrated ✓ — the sensor's estimates just got more accurate.";
    }
  }

  els.weeklyPct.value = "";
  render();
  // After render, so renderSensor doesn't immediately overwrite the feedback;
  // the next 30 s tick restores the regular sensor line.
  if (calibrationNote) setText(els.sensorLine, calibrationNote);
});

// Programmatic import — the tray's auto-refresh (app/tray.js) goes through
// the same parse/validate/store path as a manual paste.
addEventListener("pace:sensor-json", (e) => {
  const err = importSensorJson(e.detail);
  if (err) setText(els.sensorLine, err);
  else render();
});

els.sensorImport.addEventListener("click", () => {
  const err = importSensorJson(els.sensorPaste.value.trim());
  if (err) {
    setText(els.sensorLine, err);
    return;
  }
  els.sensorPaste.value = "";
  render();
});

els.sensorFile.addEventListener("change", async () => {
  const file = els.sensorFile.files?.[0];
  if (!file) return;
  const err = importSensorJson(await file.text());
  if (err) setText(els.sensorLine, err);
  else render();
  els.sensorFile.value = "";
});

els.sessionForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const pct = Number(els.sessionPct.value);
  const t = els.sessionResets.value; // "HH:MM"
  if (!Number.isFinite(pct) || pct < 0 || pct > 100 || !t) return;
  const [h, m] = t.split(":").map(Number);
  const resetsAt = new Date();
  resetsAt.setHours(h, m, 0, 0);
  if (resetsAt <= new Date()) resetsAt.setDate(resetsAt.getDate() + 1); // "7 PM" said at 11 PM = tomorrow
  state.session = { pct, resetsAt: resetsAt.getTime() };
  save();
  render();
});

for (const el of [els.resetDow, els.resetHour]) {
  el.addEventListener("change", () => {
    state.resetDow = Number(els.resetDow.value);
    state.resetHour = Number(els.resetHour.value);
    save();
    render();
  });
}

els.clear.addEventListener("click", () => {
  if (!confirm("Delete all Pace data from this browser?")) return;
  for (const k of [KEY, CAL_KEY, SENSOR_KEY]) localStorage.removeItem(k);
  state = load();
  cal = emptyCalibration();
  sensor = null;
  render();
});

/* ---------------- init ---------------- */

els.resetHour.replaceChildren(
  ...Array.from({ length: 24 }, (_, h) => {
    const o = document.createElement("option");
    o.value = String(h);
    o.textContent = new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });
    return o;
  })
);
els.resetDow.value = String(state.resetDow);
els.resetHour.value = String(state.resetHour);

render();
setInterval(render, 30_000); // time keeps moving even when the number is stale
