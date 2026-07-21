/**
 * Pace tracker (bogez/pace#5): manual /usage check-ins → live color.
 *
 * All pace math comes from the engine; all window math from window.js.
 * This file is only wiring: storage, forms, and rendering. It makes no
 * network calls and never will (TRUST.md commitment 2).
 */
import { paceDelta, paceColor, paceState, forecast } from "../src/pace.js";
import { weeklyWindow, sessionWindow, stalenessTier, hoursBetween, WEEK_HOURS, SESSION_HOURS } from "./window.js";

/* ---------------- storage ---------------- */

const KEY = "pace.tracker.v1";

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

let state = load();

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

  if (!checkin) {
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
    setText(els.ageLine, "");
    els.dot.classList.remove("stale");
    els.setup.open = state.checkins.length === 0;
  } else {
    const delta = paceDelta(checkin.weeklyPct, win.elapsedHours, WEEK_HOURS);
    const st = paceState(delta);
    const age = hoursBetween(new Date(checkin.t), now);
    const tier = stalenessTier(age);

    els.dot.style.background = paceColor(delta);
    // Stale: every channel degrades, not just color — desaturated dot,
    // "probably" in the words, qualified forecast (#9, charter principle 3).
    els.dot.classList.toggle("stale", tier === "stale");
    setText(els.glyph, st.glyph);
    setText(els.stateName, tier === "stale" ? `probably ${st.name}` : st.name);
    setText(
      els.deltaLine,
      `${checkin.weeklyPct}% used, ${win.elapsedPct.toFixed(0)}% of the week elapsed — ${fmtDelta(delta)}`
    );

    const f = forecast(checkin.weeklyPct, win.elapsedHours, WEEK_HOURS);
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
        els.forecastLine.textContent + ` (Based on a check-in ${fmtHours(age)} ago.)`
      );
    }

    setText(
      els.ageLine,
      tier === "fresh"
        ? `Checked in ${fmtHours(age)} ago.`
        : tier === "aging"
          ? `◌ Checked in ${fmtHours(age)} ago — worth a fresh look at /usage.`
          : `◌ Checked in ${fmtHours(age)} ago — this color is a guess until you check /usage.`
    );
  }

  renderSession(now);
  renderHistory(win);
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
  state.checkins.push({ t: Date.now(), weeklyPct: pct });
  if (state.checkins.length > 100) state.checkins = state.checkins.slice(-100);
  save();
  els.weeklyPct.value = "";
  render();
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
  localStorage.removeItem(KEY);
  state = load();
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
