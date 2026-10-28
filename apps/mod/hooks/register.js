/**
 * Pace kitchen — the mod's hooks module. Wiring only: what the chef looks like
 * and what mood a reading puts him in live in ../lib/kitchen.js (pure, tested
 * in node); this file connects that to Claude Code.
 *
 *   session.measure  → new rate-limit reading: re-pick the mood, redraw, and
 *                      tee the reading to ~/.pace/usage.json for the tray
 *   /pace            → toggle the kitchen pane (/pace <mood> previews one)
 *   ui.render Pane   → the chef: a Raster in the terminal (animated by blit),
 *                      an SMIL-animated Svg in Desktop, captions everywhere
 *   ui.render Spinner→ "· ● in the zone" after Claude's working word
 *
 * Trust (TRUST.md): the only write is the usage file, the same document and
 * path the statusline bridge (sensors/statusline.mjs) writes. No network.
 */
import { MOODS, W, H, moodFor, previewMood, caption, details, scene, rasterCells, svgFor } from "../lib/kitchen.js";

const PANE = "pace-kitchen";
const RASTER = "chef";
const TICK_MS = 50;
const REMOOD_MS = 60_000; // elapsed time moves the pace even with no new reading

let rateLimits = [];
let preview = null; // a mood name while /pace <mood> is previewing
let current = moodFor([], 0);
let isOpen = false;
let drawnOn = null; // the surface the pane last drew on
let frame = 0;
let sinceFrame = 0;
let sinceRemood = 0;

const moodName = () => preview || current.mood;
const hexOf = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

async function remood($) {
  current = moodFor(rateLimits, await $.clock.now());
}

/** The statusline bridge's document, so the tray reads either source. */
function usageDoc(limits, nowMs) {
  const rl = {};
  for (const r of limits) {
    if (r.kind !== "five_hour" && r.kind !== "seven_day") continue;
    const resetMs = r.resetsAt ? Date.parse(r.resetsAt) : NaN;
    rl[r.kind] = {
      used_percentage: r.percentUsed,
      ...(Number.isFinite(resetMs) ? { resets_at: Math.round(resetMs / 1000) } : {}),
    };
  }
  if (!rl.five_hour && !rl.seven_day) return null;
  return {
    source: "claude-code-mod",
    generatedAt: new Date(nowMs).toISOString(),
    rate_limits: rl,
  };
}

async function teeUsage($, limits) {
  const doc = usageDoc(limits, await $.clock.now());
  if (!doc) return;
  const home = (await $.env.get("HOME")) || (await $.env.get("USERPROFILE"));
  const file = (await $.env.get("PACE_USAGE_FILE")) || (home && `${home}/.pace/usage.json`);
  if (!file) return;
  try {
    await $.fs.write(file, JSON.stringify(doc, null, 2) + "\n");
  } catch {
    // an unwritable file must never break the session
  }
}

export function register(on) {
  on("session.start", async ($, e, next) => {
    try {
      rateLimits = (await $.session.usage()).rateLimits || [];
    } catch {
      rateLimits = [];
    }
    await remood($);

    // One ticker: advances the terminal animation at the mood's tempo, and
    // re-picks the mood once a minute as the week's clock moves on.
    $.clock.every(TICK_MS, async () => {
      sinceRemood += TICK_MS;
      if (sinceRemood >= REMOOD_MS) {
        sinceRemood = 0;
        const before = current.mood;
        await remood($);
        if (current.mood !== before) $.ui.invalidate("ui.render");
      }
      if (!isOpen || drawnOn !== "terminal") return;
      sinceFrame += TICK_MS;
      const ms = MOODS[moodName()].ms;
      if (sinceFrame < ms) return;
      sinceFrame = Math.min(sinceFrame - ms, ms); // keep the tempo, never burst
      frame += 1;
      const { cells } = rasterCells(scene(moodName(), frame));
      $.ui.blit({ requestId: PANE, key: RASTER, cells }).catch(() => {});
    });

    try {
      await $.command.register({
        name: "pace",
        description: "Open the Pace kitchen — your usage pace as a cooking chef",
        argumentHint: "[cold|cool|zone|warm|hot|burning|live]",
        immediate: true,
      });
    } catch {
      // a name clash must not take the rest of the mod down
    }
    return next(e);
  });

  on("session.measure", async ($, e, next) => {
    if (e.changed.includes("rateLimits")) {
      rateLimits = e.rateLimits || [];
      const before = current.mood;
      await remood($);
      if (current.mood !== before) $.ui.invalidate("ui.render");
      await teeUsage($, rateLimits);
    }
    return next(e);
  });

  on("command.run", { command: "pace" }, async ($, e) => {
    const arg = (e.args || "").trim();
    if (arg && arg !== "live") {
      if (!MOODS[arg] || arg === "idle") {
        return { text: `Unknown mood "${arg}". Try: cold, cool, zone, warm, hot, burning, or live.` };
      }
      preview = arg;
      $.ui.invalidate("ui.render");
      if (!isOpen) await openPane($);
      return {};
    }
    if (arg === "live") {
      preview = null;
      $.ui.invalidate("ui.render");
      if (!isOpen) await openPane($);
      return {};
    }
    if (isOpen) {
      await $.ui.close({ id: PANE });
      isOpen = false;
    } else {
      await openPane($);
    }
    return {};
  });

  on("ui.close", async ($, e, next) => {
    if (e.id === PANE) isOpen = false;
    return next(e);
  });

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Raster, Svg } = $.ui.resolve(e);
    drawnOn = e.surface;
    const mood = moodName();
    const m = preview ? previewMood(preview) : current;
    const color = m.rgb ? hexOf(m.rgb) : undefined;

    const art = [];
    if (e.surface === "terminal" && Raster) {
      const r = rasterCells(scene(mood, frame));
      art.push(Raster({ key: RASTER, columns: r.columns, rows: r.rows, cells: r.cells }));
    } else if (Svg) {
      art.push(Svg({ source: svgFor(mood), alt: caption(m), isInteractive: true, width: W * 5, height: H * 5 }));
    }

    const lines = [Text({ bold: true, ...(color ? { color } : {}), children: [caption(m)] })];
    const numbers = preview ? `previewing — /pace live to go back` : details(m);
    if (numbers) lines.push(Text({ dimColor: true, children: [numbers] }));

    return Box({ flexDirection: "column", children: [...art, ...lines] });
  });

  on("ui.render", { component: "Spinner" }, async ($, e, next) => {
    if (current.mood === "idle") return next(e);
    const tail = e.props.suffix ?? "…";
    return next({ ...e, props: { ...e.props, suffix: ` · pace ${current.glyph} ${current.name}${tail}` } });
  });
}

async function openPane($) {
  // Opened from a command, so it places at any width.
  const r = await $.ui.open({ id: PANE, title: "Pace kitchen", closeOnEscape: true });
  isOpen = r?.isPlaced !== false;
  frame = 0;
  sinceFrame = 0;
}
