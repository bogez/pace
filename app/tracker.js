/**
 * Pace tracker (bogez/pace#5, #13, #51): manual /usage check-ins and
 * measured statusline snapshots → live color, plus sensor-derived
 * estimates with honest calibration as the fallback.
 *
 * All pace math comes from the engine; window math from window.js;
 * calibration math from calibration.js (docs/design/calibration.md);
 * statusline parsing from measured.js (docs/design/measured-usage.md).
 * This file is only wiring: storage, forms, and rendering. It makes no
 * network calls and never will (TRUST.md commitment 2).
 *
 * Measured vs. estimated (TRUST.md commitment 5): manual check-ins and
 * Claude Code statusline snapshots are both *measured* — the freshest one
 * drives the meter in the measured style. The sensor estimate is used only
 * when it is newer than every measured reading, and then it says so on
 * every channel — dashed dot outline, "≈" on the number, and a source line
 * naming the sensor. Measured readings also stay a floor afterwards: usage
 * never goes down inside a window, so an estimate below the last in-window
 * measured reading is provably wrong and is clamped up to it.
 */
import { paceDelta, paceColor, paceState, forecast } from "../src/pace.js";
import { weeklyWindow, windowFromReset, sessionWindow, stalenessTier, hoursBetween, WEEK_HOURS, SESSION_HOURS } from "./window.js";
import { observe, estimatePct, recompute, emptyCalibration, weightedFromRaw } from "./calibration.js";
import { parseMeasured } from "./measured.js";
import { WEIGHTS_VERSION } from "../sensors/weights.mjs";
import { trayState } from "./tray-format.js";

/* ---------------- storage ---------------- */

const KEY = "pace.tracker.v1";
const CAL_KEY = "pace.calibration.v1";
const SENSOR_KEY = "pace.sensor.v1";
const MEASURED_KEY = "pace.measured.v1";
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
let measured = loadJson(MEASURED_KEY, null); // { t, weekly, session } from measured.js

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
  meter: $("meter"),
  spectrum: $("spectrum"),
  needle: $("needle"),
  stateDesc: $("state-desc"),
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

// Headline descriptors (#46) — presentation only; the engine's state names
// stay the accessible channel and the test contract.
const DESCRIPTORS = {
  overheating: "over the line",
  "running hot": "burning fast",
  warm: "a bit fast",
  "in the zone": "perfect pace",
  cool: "headroom",
  cold: "deep headroom",
};

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
 * newer than the last measured reading (a measurement always wins — it is
 * ground truth).
 */
function currentEstimate(win, ground) {
  if (!sensor || cal.K == null) return null;
  if (sensor.t < win.start.getTime()) return null;
  if (ground && ground.t >= sensor.t) return null;
  const pct = estimatePct(cal, sensor.weighted);
  if (pct == null) return null;
  // Usage is cumulative inside a window: it can't be below what /usage
  // already showed, so the last in-window measurement floors the estimate.
  const floor = ground ? ground.pct : 0;
  return { pct: Math.min(Math.max(pct, floor), 100), t: sensor.t };
}

/** Latest check-in belonging to the current window, or null. */
function currentCheckin(win) {
  const last = state.checkins.at(-1);
  if (!last) return null;
  return last.t >= win.start.getTime() ? last : null;
}

/**
 * The weekly statusline snapshot as a measured reading for the current
 * window, or null — absent, from before the window, or its own window
 * already reset (its number describes a week that ended).
 */
function currentMeasuredWeekly(win, now) {
  const w = measured?.weekly;
  if (!w || measured.t < win.start.getTime()) return null;
  if (w.resetsAt != null && w.resetsAt <= now.getTime()) return null;
  return { pct: Math.min(w.pct, 100), t: measured.t, source: "statusline" };
}

/**
 * The freshest *measured* weekly reading — manual check-in or statusline
 * snapshot (#51). Both are real /usage numbers; recency decides.
 */
function currentGround(win, now) {
  const c = currentCheckin(win);
  let g = c ? { pct: c.weeklyPct, t: c.t, source: "checkin" } : null;
  const m = currentMeasuredWeekly(win, now);
  if (m && (!g || m.t > g.t)) g = m;
  return g;
}

/**
 * The weekly window to render against: derived from the statusline's
 * measured resets_at when one is live (#51 — the provider's own boundary,
 * no setup), else the configured day-of-week anchor.
 */
function currentWin(now) {
  const resetsAt = measured?.weekly?.resetsAt;
  return (
    (resetsAt != null && windowFromReset(now, resetsAt)) ||
    weeklyWindow(now, state.resetDow, state.resetHour)
  );
}

/* ---------------- render ---------------- */

function render() {
  const now = new Date();
  const win = currentWin(now);
  const ground = currentGround(win, now);
  const est = currentEstimate(win, ground);
  // The freshest of (measured reading, calibrated sensor estimate) drives
  // the meter; `estimated` flags which class won, `source` which measured
  // channel (manual check-in vs. statusline snapshot).
  const reading = est
    ? { pct: est.pct, t: est.t, estimated: true }
    : ground
      ? { pct: ground.pct, t: ground.t, estimated: false, source: ground.source }
      : null;

  if (!reading) {
    els.dot.style.background = "";
    els.meter.style.removeProperty("--pace-ink");
    els.needle.hidden = true;
    els.spectrum.classList.add("empty");
    els.spectrum.classList.remove("stale");
    setText(els.stateDesc, "");
    setText(els.glyph, "●");
    els.glyph.classList.add("dup"); // visually redundant next to the gray dot
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
    // The needle sits at the delta on the −50…+50 spectrum (#46).
    els.needle.hidden = false;
    els.needle.style.left = `${Math.min(Math.max(delta, -50), 50) + 50}%`;
    els.spectrum.classList.remove("empty");
    // Stale: every channel degrades, not just color — desaturated dot AND
    // spectrum, "probably" in the words, qualified forecast (#9, principle 3).
    els.spectrum.classList.toggle("stale", tier === "stale");
    els.dot.classList.toggle("stale", tier === "stale");
    // Estimated: dashed outline + "≈" + source line (TRUST.md commitment 5).
    els.dot.classList.toggle("estimated", reading.estimated);
    // The headline tint (prototype look): large bold text at WCAG large-text
    // contrast; the light theme mixes it toward ink in CSS. Words + glyph
    // remain the color-independent channel (#8).
    els.meter.style.setProperty("--pace-ink", paceColor(delta));
    setText(els.glyph, st.glyph);
    // "●" would visually duplicate the dot beside it; directions still show.
    els.glyph.classList.toggle("dup", st.glyph === "●");
    setText(els.stateName, tier === "stale" ? `probably ${st.name}` : st.name);
    setText(els.stateDesc, DESCRIPTORS[st.name] ? ` — ${DESCRIPTORS[st.name]}` : "");
    const pctLabel = reading.estimated
      ? `≈${reading.pct.toFixed(0)}% used (estimated)`
      : `${reading.pct}% used`;
    setText(
      els.deltaLine,
      `${pctLabel} · ${win.elapsedPct.toFixed(1)}% expected · delta ${delta > 0 ? "+" : ""}${delta.toFixed(1)}`
    );
    setText(
      els.sourceLine,
      reading.estimated
        ? "Estimated from the Claude Code sensor + your calibration — log a check-in to correct it."
        : reading.source === "statusline"
          ? "Measured by Claude Code — the same number /usage shows."
          : ""
    );

    const f = forecast(reading.pct, win.elapsedHours, WEEK_HOURS);
    if (!f) {
      setText(els.forecastLine, "");
    } else {
      // The number is <strong> (prototype look); text around it stays muted.
      let pre, num, post;
      if (f.runsOut) {
        const short = WEEK_HOURS - win.elapsedHours - f.unitsToExhaustion;
        pre = "At your average pace you hit 100% about ";
        num = fmtHours(short);
        post = " before the reset.";
      } else {
        pre = "At your average pace you'd end the week at ";
        num = `${Math.round(f.projectedPct)}%`;
        post = f.projectedPct < 85 ? " — you can afford to push." : " — cutting it close.";
      }
      if (tier === "stale") {
        const basis = reading.estimated
          ? "a sensor snapshot"
          : reading.source === "statusline"
            ? "a measured snapshot"
            : "a check-in";
        post += ` (Based on ${basis} ${fmtHours(age)} ago.)`;
      }
      const strong = document.createElement("strong");
      strong.textContent = num;
      els.forecastLine.replaceChildren(pre, strong, post);
    }

    const what = reading.estimated
      ? "Sensor snapshot"
      : reading.source === "statusline"
        ? "Measured snapshot"
        : "Checked in";
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
  renderSensor(now, win, ground);
  renderHistory(win);

  // The tray bridge (app/tray.js) listens for this; in a plain browser
  // nothing does and the event evaporates.
  dispatchEvent(new CustomEvent("pace:reading", { detail: trayState(reading, win, now) }));
}

function renderSession(now) {
  // Candidates: the manual entry and the measured statusline session
  // window (#51). The freshest one whose window is still live wins; the
  // manual form remains the correction channel, same as the weekly meter.
  const candidates = [];
  if (state.session)
    candidates.push({ pct: state.session.pct, resetsAt: state.session.resetsAt, t: state.session.t ?? 0, measured: false });
  if (measured?.session?.resetsAt != null)
    candidates.push({ pct: measured.session.pct, resetsAt: measured.session.resetsAt, t: measured.t, measured: true });

  let best = null;
  let sw = null;
  for (const c of candidates) {
    const w = sessionWindow(now, new Date(c.resetsAt));
    if (!w) continue;
    if (!best || c.t > best.t) {
      best = c;
      sw = w;
    }
  }
  if (!best) {
    // Every stated session ended — yesterday's number means nothing now.
    // Deliberately no save() here: this runs on the 30 s tick, and a save
    // from a stale background instance would overwrite check-ins another
    // instance wrote in the meantime. sessionWindow() already treats the
    // expired entry as absent; the next user-initiated save prunes it.
    if (state.session && !sessionWindow(now, new Date(state.session.resetsAt))) state.session = null;
    els.sessionLine.textContent = "";
    return;
  }
  const delta = paceDelta(best.pct, sw.elapsedHours, SESSION_HOURS);
  const st = paceState(delta);
  // Color rides on the ring, never on the text — colored text can't hold AA
  // contrast across the whole ramp, and the words must stay readable (#8).
  // The ring's arc is the session's usage %, its color the session pace (#46).
  const ring = document.createElement("span");
  ring.className = "ring";
  ring.setAttribute("aria-hidden", "true");
  ring.style.background = `conic-gradient(${paceColor(delta)} ${best.pct}%, var(--line) 0)`;
  const hole = document.createElement("span");
  hole.className = "ring-hole";
  hole.textContent = `${Math.round(best.pct)}%`;
  ring.append(hole);
  els.sessionLine.replaceChildren(
    ring,
    ` ${st.glyph} ${st.name} — ${best.pct}% used, ` +
      `${fmtHours(SESSION_HOURS - sw.elapsedHours)} until the session resets` +
      (best.measured ? " · measured by Claude Code" : "")
  );
}

function renderSensor(now, win, ground) {
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
  // Same floor as the meter (currentEstimate): a snapshot taken after the
  // last measurement can't map to less usage than /usage already showed.
  const floor = ground && ground.t <= sensor.t ? ground.pct : 0;
  setText(
    els.sensorLine,
    pct == null
      ? // The honest zero state: raw tokens, never an invented percent.
        `${M(sensor.weighted)} weighted tokens this week (snapshot ${age} ago). ` +
        `Log what /usage shows once to calibrate — then Pace can estimate your %.`
      : `${M(sensor.weighted)} weighted tokens ≈ ${Math.min(Math.max(pct, floor), 100).toFixed(0)}% (snapshot ${age} ago, ` +
        `calibrated from ${cal.log.length} check-in${cal.log.length === 1 ? "" : "s"}).`
  );
}

/**
 * The calibration act (#13, #51): a real /usage percentage — typed in, or
 * measured off the statusline — paired with a recent sensor snapshot
 * teaches the scale factor. Only pair readings that describe (nearly) the
 * same moment. Returns a user-facing note, or null when nothing calibrated.
 */
function calibrateFrom(pct, t) {
  const win = currentWin(new Date(t));
  if (
    !sensor ||
    sensor.t < win.start.getTime() ||
    hoursBetween(new Date(sensor.t), new Date(t)) > CALIBRATION_PAIRING_HOURS
  )
    return null;
  const r = observe(cal, { t, U: pct, raw: sensor.raw });
  if (!r.accepted) return null;
  cal = r.cal;
  saveJson(CAL_KEY, cal);
  return r.unstable
    ? "⚠ Calibration updated, but this reading disagrees strongly with earlier ones — " +
        "if the next one does too, your usage mix may have changed."
    : "Calibrated ✓ — the sensor's estimates just got more accurate.";
}

/** Feedback from the last import (e.g. a calibration note), shown post-render. */
let importNote = null;

/**
 * Parse and store an import: sensor --json output, or measured statusline
 * JSON (raw stdin document or the bridge's teed file — anything carrying
 * rate_limits, see docs/design/measured-usage.md). Returns an error string
 * or null.
 */
function importUsageJson(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return "That doesn't parse as JSON — paste the exact output.";
  }
  if (d?.rate_limits) {
    const m = parseMeasured(d, Date.now());
    if (!m) return "That has rate_limits, but no usable used_percentage numbers inside it.";
    // The tray re-reads the teed file on a timer; the same snapshot must not
    // re-calibrate (duplicate log entries) — only genuinely new readings do.
    const isNew = !measured || m.t > measured.t;
    measured = m;
    saveJson(MEASURED_KEY, measured);
    // A measured weekly % is as real as a typed one — calibrate from it, so
    // the estimate fallback improves without the user ever typing (#51).
    importNote = isNew && m.weekly ? calibrateFrom(m.weekly.pct, m.t) : null;
    return null;
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

  const calibrationNote = calibrateFrom(pct, now);

  els.weeklyPct.value = "";
  render();
  // After render, so renderSensor doesn't immediately overwrite the feedback;
  // the next 30 s tick restores the regular sensor line.
  if (calibrationNote) setText(els.sensorLine, calibrationNote);
});

/** One import path for every source: paste, file, and the tray's refresh. */
function applyImport(text) {
  const err = importUsageJson(text);
  if (err) {
    setText(els.sensorLine, err);
    return false;
  }
  render();
  // After render, so renderSensor doesn't immediately overwrite the note;
  // the next 30 s tick restores the regular sensor line.
  if (importNote) {
    setText(els.sensorLine, importNote);
    importNote = null;
  }
  return true;
}

// Programmatic import — the tray's auto-refresh (app/tray.js) goes through
// the same parse/validate/store path as a manual paste.
addEventListener("pace:sensor-json", (e) => {
  applyImport(e.detail);
});

els.sensorImport.addEventListener("click", () => {
  if (applyImport(els.sensorPaste.value.trim())) els.sensorPaste.value = "";
});

els.sensorFile.addEventListener("change", async () => {
  const file = els.sensorFile.files?.[0];
  if (!file) return;
  applyImport(await file.text());
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
  // `t` lets recency arbitrate against a measured statusline session (#51).
  state.session = { pct, resetsAt: resetsAt.getTime(), t: Date.now() };
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

// Another instance wrote to storage — a second tab, the installed PWA
// window, or the tray popover. Reload before this instance's next save
// wholesale-overwrites the shared keys with its stale in-memory copy;
// without this, a check-in logged in one instance was silently rolled
// back by the next save from any other.
function reloadFromStorage() {
  state = load();
  cal = loadJson(CAL_KEY, emptyCalibration());
  sensor = loadJson(SENSOR_KEY, null);
  measured = loadJson(MEASURED_KEY, null);
  els.resetDow.value = String(state.resetDow);
  els.resetHour.value = String(state.resetHour);
  render();
}
addEventListener("storage", (e) => {
  if (e.key === null || [KEY, CAL_KEY, SENSOR_KEY, MEASURED_KEY].includes(e.key)) reloadFromStorage();
});
// A page restored from the back/forward cache missed the storage events
// that fired while it was frozen.
addEventListener("pageshow", (e) => {
  if (e.persisted) reloadFromStorage();
});

els.clear.addEventListener("click", () => {
  if (!confirm("Delete all Pace data from this browser?")) return;
  for (const k of [KEY, CAL_KEY, SENSOR_KEY, MEASURED_KEY]) localStorage.removeItem(k);
  state = load();
  cal = emptyCalibration();
  sensor = null;
  measured = null;
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
