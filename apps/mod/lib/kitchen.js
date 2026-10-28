/**
 * The Pace kitchen: an 8-bit chef whose cooking is the pace meter.
 *
 * Pure module — no `$`, no clock, no I/O — so node tests can drive it and the
 * mod's hooks only wire it to Claude Code. Three layers:
 *
 *   reading → mood     moodFor(): the pace engine's state, mapped to a dish
 *   mood → pixels      scene(): one frame of the kitchen as a palette grid
 *   pixels → surface   rasterCells() for the terminal, svgFor() for Desktop
 *
 * The mood is a costume on paceState(), never a second opinion: boundaries
 * come from ZONES via paceState(), and every caption leads with the state's
 * glyph and name (charter principle 2: never color — or a cartoon — alone).
 */
import { paceDelta, paceState, paceColorRgb } from "./pace.js";

export const W = 44;
export const H = 30;
export const WEEK_HOURS = 168;

/** Palette: one character per color in the sprite strings below. */
export const COLORS = Object.freeze({
  K: 0x2b2b33, // outline
  W: 0xf4f4f0, // whites
  w: 0xc9c9c4, // white shade
  S: 0xf1c27d, // skin
  s: 0xd9a066, // skin shade
  M: 0x6b3e26, // mustache
  R: 0xd03b3b, // neckerchief
  B: 0x3a3f58, // trousers
  G: 0x8a8f99, // pot
  g: 0x5c616b, // pot shade
  P: 0xb07a43, // wooden spoon
  T: 0x45454d, // stove top
  L: 0x6e6e78, // stove body
  F: 0xff8c1a, // flame orange
  Y: 0xffd23f, // flame yellow
  r: 0xe0392b, // flame red
  U: 0x4f9dff, // low gas flame (blue)
  O: 0xe8eef2, // steam
  o: 0x9a9a9a, // grey smoke
  X: 0x3a3a3a, // black smoke
  I: 0x9fd3ff, // ice
  D: 0x6ec6ff, // sweat
  "*": 0xfff59d, // sparkle
  // what's in the pot, by mood
  c: 0xcfe3ef, // raw and cold
  a: 0xd8b46a, // warming
  Z: 0xe8a33d, // golden, perfect
  h: 0xb8661e, // browning fast
  H: 0x8a4a14, // scorching
  Q: 0x2a1d14, // charcoal
});

/**
 * Moods, in pace order. `state` is the paceState() name each one dresses;
 * `ms` is the frame time — the kitchen gets frantic as you run hot.
 */
export const MOODS = Object.freeze({
  idle: { state: null, ms: 700, flame: 0, food: null, line: "waiting for the first usage reading" },
  cold: { state: "cold", ms: 650, flame: 0, food: "c", line: "the stove's barely on — plenty of headroom" },
  cool: { state: "cool", ms: 420, flame: 1, food: "a", line: "simmering low — room to turn up the heat" },
  zone: { state: "in the zone", ms: 260, flame: 2, food: "Z", line: "cooking perfectly" },
  warm: { state: "warm", ms: 190, flame: 3, food: "h", line: "bubbling a little fast" },
  hot: { state: "running hot", ms: 140, flame: 3, food: "H", line: "boiling over — ease off" },
  burning: { state: "overheating", ms: 100, flame: 4, food: "Q", line: "it's burning — you'll hit the limit before reset" },
});

const MOOD_BY_STATE = Object.fromEntries(
  Object.entries(MOODS).map(([k, m]) => [m.state, k]).filter(([s]) => s)
);

/** Every mood has this many frames; animation is frame % FRAMES. */
export const FRAMES = 4;

/**
 * Turn the rate-limit windows Claude Code reports into a mood + caption.
 *
 * @param {{kind: string, percentUsed: number, resetsAt?: string}[]} rateLimits
 *   `$.session.usage().rateLimits` / `session.measure`'s `e.rateLimits`
 * @param {number} nowMs
 * @returns {{ mood: string, delta: number|null, glyph: string, name: string,
 *   rgb: number[]|null, weekPct: number|null, elapsedPct: number|null,
 *   sessionPct: number|null, resetsAt: number|null }}
 */
export function moodFor(rateLimits, nowMs) {
  const find = (kind) => (rateLimits || []).find((r) => r && r.kind === kind);
  const week = find("seven_day");
  const five = find("five_hour");
  const sessionPct = Number.isFinite(five?.percentUsed) ? five.percentUsed : null;
  const resetsAt = week?.resetsAt ? Date.parse(week.resetsAt) : NaN;
  const base = { sessionPct, weekPct: null, elapsedPct: null, resetsAt: null, delta: null, rgb: null };
  if (!week || !Number.isFinite(week.percentUsed) || !Number.isFinite(resetsAt)) {
    return { ...base, mood: "idle", glyph: "·", name: "no reading yet" };
  }
  const elapsed = WEEK_HOURS - (resetsAt - nowMs) / 36e5;
  // A reset in the past or more than a week out is a stale or foreign
  // reading; refuse to dress it up rather than guess (charter principle 3).
  if (elapsed < 0 || elapsed > WEEK_HOURS) {
    return { ...base, weekPct: week.percentUsed, mood: "idle", glyph: "·", name: "reading out of window" };
  }
  return {
    ...moodForDelta(paceDelta(week.percentUsed, elapsed, WEEK_HOURS)),
    weekPct: week.percentUsed,
    elapsedPct: (elapsed / WEEK_HOURS) * 100,
    sessionPct,
    resetsAt,
  };
}

/** Mood, glyph, name and color for a pace delta — paceState() in costume. */
export function moodForDelta(delta) {
  const st = paceState(delta);
  return { mood: MOOD_BY_STATE[st.name], delta, glyph: st.glyph, name: st.name, rgb: paceColorRgb(delta) };
}

/** A representative delta inside each mood's zone, for /pace <mood> previews. */
const PREVIEW_DELTA = { cold: -40, cool: -15, zone: 0, warm: 10, hot: 20, burning: 35 };

/** What /pace <mood> shows: the real state and color for that zone, no numbers. */
export function previewMood(mood) {
  if (!(mood in PREVIEW_DELTA)) throw new RangeError(`no preview for mood: ${mood}`);
  return { ...moodForDelta(PREVIEW_DELTA[mood]), weekPct: null, elapsedPct: null, sessionPct: null, resetsAt: null };
}

/** One-line caption: glyph and state name first, then the dish. */
export function caption(m) {
  if (m.mood === "idle") return `${m.glyph} ${m.name} — ${MOODS.idle.line}`;
  return `${m.glyph} ${m.name} — ${MOODS[m.mood].line}`;
}

/** The numbers behind the dish, for the line under the caption. */
export function details(m) {
  const parts = [];
  if (m.weekPct != null) parts.push(`week ${fmt(m.weekPct)}% used`);
  if (m.elapsedPct != null) parts.push(`${fmt(m.elapsedPct)}% of the week gone`);
  if (m.sessionPct != null) parts.push(`5h ${fmt(m.sessionPct)}%`);
  return parts.join(" · ");
}
const fmt = (n) => (Math.round(n * 10) / 10).toString();

// ── sprites ────────────────────────────────────────────────────────────────

// The chef faces right, toward the stove. Eye and mouth pixels are drawn per
// expression on top of this base, so the base leaves them as skin.
const CHEF = [
  "....KKKKK.......",
  "..KKWWWWWKK.....",
  ".KWWWWWWWWWK....",
  ".KWWWwWWWWWK....",
  "..KWWWWWWWK.....",
  "..KwwwwwwwK.....",
  "..KSSSSSSSSK....",
  "..KSSSSSSSSK....",
  "..KsSSSSSSSSK...",
  "..KsSSMMMMSK....",
  "...KsSSSSSK.....",
  "....KRRRRK......",
  "..KWWWWWWWWK....",
  ".KWWWWKWWWWWK...",
  ".KWWWWWWWWWWK...",
  ".KWWWWKWWWWWK...",
  ".KwWWWWWWWWWK...",
  "..KBBBBBBBBK....",
  "..KBBBBKBBBK....",
  "..KBBBK.KBBK....",
  "..KBBBK.KBBK....",
  ".KKKKKK.KKKKK...",
];
const CHEF_X = 1;
const CHEF_Y = H - CHEF.length; // feet on the floor

// Pot geometry (global pixels).
const POT = { x0: 23, x1: 40, rim: 13, bottom: 21 };
const STOVE = { x0: 19, x1: 43, top: 24 };

// ── grid helpers ───────────────────────────────────────────────────────────

const blank = () => Array.from({ length: H }, () => Array(W).fill("."));
function put(g, x, y, c) {
  if (x >= 0 && x < W && y >= 0 && y < H && c !== ".") g[y][x] = c;
}
function sprite(g, rows, ox, oy) {
  rows.forEach((row, y) => [...row].forEach((c, x) => put(g, ox + x, oy + y, c)));
}
function hline(g, x0, x1, y, c) {
  for (let x = x0; x <= x1; x++) put(g, x, y, c);
}
/** Thick-ish line by DDA; good enough for arms and spoons at this scale. */
function line(g, x0, y0, x1, y1, c) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    put(g, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c);
  }
}

// ── scene layers ───────────────────────────────────────────────────────────

function stove(g) {
  hline(g, STOVE.x0, STOVE.x1, STOVE.top, "T");
  for (let y = STOVE.top + 1; y < H; y++) {
    hline(g, STOVE.x0, STOVE.x1, y, "L");
    put(g, STOVE.x0, y, "K");
    put(g, STOVE.x1, y, "K");
  }
  hline(g, STOVE.x0, STOVE.x1, H - 1, "K");
  // knobs
  for (const kx of [23, 27, 35, 39]) {
    put(g, kx, 26, "K");
    put(g, kx + 1, 26, "K");
    put(g, kx, 27, "K");
    put(g, kx + 1, 27, "K");
  }
  // burner grate under the pot
  hline(g, POT.x0 + 2, POT.x1 - 2, 23, "K");
}

function flames(g, level, f) {
  if (level === 0) return;
  const xs = [];
  for (let x = POT.x0 + 2; x <= POT.x1 - 2; x += 2) xs.push(x + ((f >> 1) & 1));
  if (level === 1) {
    // a low blue gas flame
    xs.forEach((x, i) => put(g, x, 22, (i + f) % 2 ? "U" : "."));
    return;
  }
  for (const [i, x] of xs.entries()) {
    const tall = (i + f) % 2;
    put(g, x, 22, "F");
    put(g, x, 23 - 0, "Y");
    if (tall) put(g, x, 21, "Y");
  }
  if (level >= 3) {
    // flames licking up the sides of the pot
    const h = level === 4 ? 9 : 3;
    for (const side of [POT.x0 - 1, POT.x1 + 1]) {
      for (let k = 0; k < h; k++) {
        const y = 22 - k;
        const wob = (k + f) % 3 === 0 ? (side < POT.x0 ? -1 : 1) : 0;
        put(g, side + wob, y, k > h - 3 ? "Y" : k % 2 ? "r" : "F");
      }
    }
  }
  if (level === 4) {
    // fire over the rim
    for (let x = POT.x0 + 1; x <= POT.x1 - 1; x += 3) {
      const up = (x + f) % 2;
      put(g, x, POT.rim - 1, "F");
      put(g, x, POT.rim - 2 - up, "Y");
      put(g, x + 1, POT.rim - 1 - up, "r");
    }
  }
}

function pot(g, food) {
  const { x0, x1, rim, bottom } = POT;
  // seen a little from above: back rim, the contents, then the front lip
  hline(g, x0 + 1, x1 - 1, rim - 1, "K");
  put(g, x0, rim, "K");
  put(g, x1, rim, "K");
  hline(g, x0 + 1, x1 - 1, rim, food || "g");
  hline(g, x0, x1, rim + 1, "w");
  put(g, x0, rim + 1, "K");
  put(g, x1, rim + 1, "K");
  for (let y = rim + 2; y <= bottom; y++) {
    hline(g, x0 + 1, x1 - 1, y, "G");
    hline(g, x1 - 3, x1 - 1, y, "g");
    put(g, x0 + 2, y, y < bottom - 1 ? "w" : "G");
    put(g, x0, y, "K");
    put(g, x1, y, "K");
  }
  hline(g, x0, x1, bottom + 1, "K");
  // handles
  for (const [hx, d] of [[x0 - 1, -1], [x1 + 1, 1]]) {
    put(g, hx, rim + 3, "K");
    put(g, hx + d, rim + 3, "K");
    put(g, hx + d, rim + 4, "K");
  }
}

function bubbles(g, mood, f) {
  const food = MOODS[mood].food;
  if (mood === "warm" || mood === "hot" || mood === "burning") {
    for (let x = POT.x0 + 2 + (f % 3); x < POT.x1 - 1; x += 4) put(g, x, POT.rim - 1 - (x % 2), food);
  }
  if (mood === "hot") {
    // boiling over: drips running down the outside
    for (const [x, len] of [[POT.x0 + 3, 2 + (f % 3)], [POT.x1 - 4, 1 + ((f + 1) % 3)], [POT.x0 + 9, 1 + ((f + 2) % 2)]]) {
      for (let k = 0; k < len; k++) put(g, x, POT.rim + 2 + k, food);
    }
  }
  if (mood === "cold") {
    // icicles under the rim, a snowflake twinkling above
    for (const x of [POT.x0 + 3, POT.x0 + 8, POT.x1 - 4]) {
      put(g, x, POT.rim + 2, "I");
      put(g, x, POT.rim + 3, "I");
      put(g, x + 1, POT.rim + 2, "I");
    }
    const sx = 38;
    const sy = 6;
    if (f % 2 === 0) {
      put(g, sx, sy, "I");
      put(g, sx - 1, sy, "I");
      put(g, sx + 1, sy, "I");
      put(g, sx, sy - 1, "I");
      put(g, sx, sy + 1, "I");
    } else {
      put(g, sx - 1, sy - 1, "I");
      put(g, sx + 1, sy + 1, "I");
      put(g, sx + 1, sy - 1, "I");
      put(g, sx - 1, sy + 1, "I");
      put(g, sx, sy, "W");
    }
  }
}

const WAVE = [0, 0, 1, 1, 1, 0, 0, -1, -1, -1];
function wisp(g, x, yTop, yBottom, c, f, phase) {
  for (let y = yTop; y <= yBottom; y++) {
    put(g, x + WAVE[(y + f + phase) % WAVE.length], y, c);
  }
}

function steam(g, mood, f) {
  const top = POT.rim - 3;
  switch (mood) {
    case "cool":
      wisp(g, 31, top - 2, top, "O", f, 0);
      break;
    case "zone":
      wisp(g, 27, top - 6, top, "O", f, 0);
      wisp(g, 31, top - 8, top, "O", f, 2);
      wisp(g, 35, top - 5, top, "O", f, 4);
      sparkle(g, 39, 4, f);
      break;
    case "warm":
      for (const [x, h, p] of [[26, 7, 0], [29, 9, 3], [32, 8, 1], [35, 9, 4], [38, 6, 2]])
        wisp(g, x, top - h, top, "O", f, p);
      break;
    case "hot":
      for (const [x, h, p] of [[26, 9, 0], [29, 11, 3], [32, 10, 1], [35, 11, 4], [38, 8, 2]])
        wisp(g, x, top - h, top, h > 9 ? "o" : "O", f, p);
      break;
    case "burning":
      smoke(g, f);
      break;
  }
}

function sparkle(g, x, y, f) {
  if (f % 2) {
    put(g, x, y, "*");
    put(g, x - 1, y, "*");
    put(g, x + 1, y, "*");
    put(g, x, y - 1, "*");
    put(g, x, y + 1, "*");
  } else {
    put(g, x, y, "W");
  }
  // a second, smaller glint out of phase
  if (f % 2 === 0) put(g, x - 6, y + 4, "*");
}

function smoke(g, f) {
  // billows rising from the pot, drifting as they go
  for (let i = 0; i < 4; i++) {
    const age = (f + i * 2) % 8;
    const cx = 28 + i * 3 + (age >> 1);
    const cy = POT.rim - 3 - age * 1.5;
    const r = 1 + (age > 3 ? 1 : 0);
    const c = age > 5 ? "o" : "X";
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (dx * dx + dy * dy <= r * r + 1) put(g, Math.round(cx + dx), Math.round(cy + dy), c);
  }
}

// Chef expressions and arms, by mood.
function chef(g, mood, f) {
  const ox = CHEF_X;
  const oy = CHEF_Y;
  sprite(g, CHEF, ox, oy);
  const at = (x, y, c) => put(g, ox + x, oy + y, c);

  // eyes (local coords; the eye sits at column 9, row 7)
  if (mood === "idle") {
    // waiting for a reading: eyes open, a blink, a "…" growing over his head
    at(9, 7, "K");
    if (f === 3) at(8, 7, "K");
    for (let i = 0; i < f; i++) at(13 + i * 2, -2, "W");
  } else if (mood === "cold") {
    // dozing
    at(8, 7, "K");
    at(9, 7, "K");
  } else if (mood === "burning") {
    at(9, 6, "K");
    at(9, 7, "K");
    at(10, 6, "W");
    at(10, 7, "W");
  } else {
    at(9, 7, "K");
    if (mood === "zone" && f === 3) at(8, 7, "K"); // a contented squint
  }
  // mouth under the mustache
  if (mood === "burning") {
    at(6, 10, "K");
    at(7, 10, "K");
    at(8, 10, "K");
  } else if (mood === "zone") {
    at(7, 10, "R");
  }

  const shoulder = [ox + 11, oy + 13];
  if (mood === "burning") {
    // both arms up in panic, spoon dropped in the pot
    const lift = f % 2;
    line(g, shoulder[0], shoulder[1], ox + 14, oy + 6 - lift, "W");
    line(g, shoulder[0] + 1, shoulder[1], ox + 15, oy + 6 - lift, "W");
    put(g, ox + 14, oy + 5 - lift, "S");
    put(g, ox + 15, oy + 5 - lift, "S");
    line(g, ox + 2, oy + 13, ox - 1, oy + 6 + lift, "W");
    put(g, ox - 1, oy + 5 + lift, "S");
    // the "!"
    put(g, ox + 13, oy - 6, "R");
    put(g, ox + 13, oy - 5, "R");
    put(g, ox + 13, oy - 4, "R");
    put(g, ox + 13, oy - 2, "R");
    line(g, 33, POT.rim - 1, 37, POT.rim - 5, "P");
    return;
  }
  if (mood === "cold" || mood === "idle") {
    // arm at rest; the spoon stands in the pot on its own
    line(g, shoulder[0], shoulder[1], ox + 12, oy + 17, "W");
    put(g, ox + 12, oy + 18, "S");
    line(g, 30, POT.rim, 34, POT.rim - 6, "P");
    // Zz drifting up
    if (mood === "cold") {
      const rise = f % 4;
      zee(g, ox + 13, oy - 1 - rise);
      if (rise > 1) zee(g, ox + 17, oy - 6 - rise);
    }
    return;
  }

  // stirring: the hand sweeps between two points over the pot
  const stroke = [
    [20, 10],
    [22, 11],
    [24, 10],
    [22, 9],
  ][f % 4];
  const [hx, hy] = stroke;
  line(g, shoulder[0], shoulder[1], hx - 1, hy + 1, "W");
  line(g, shoulder[0], shoulder[1] + 1, hx - 1, hy + 2, "W");
  // spoon from the hand down into the pot (the pot body hides the rest)
  line(g, hx, hy, hx + 5, POT.rim, "P");
  put(g, hx, hy, "S");
  put(g, hx - 1, hy, "S");

  // sweat once things heat up
  if (mood === "warm" || mood === "hot") {
    const fall = f % 3;
    put(g, ox + 12, oy + 5 + fall, "D");
    if (mood === "hot") put(g, ox + 1, oy + 6 + ((f + 1) % 3), "D");
  }
}

function zee(g, x, y) {
  put(g, x, y, "W");
  put(g, x + 1, y, "W");
  put(g, x + 2, y, "W");
  put(g, x + 1, y + 1, "W");
  put(g, x, y + 2, "W");
  put(g, x + 1, y + 2, "W");
  put(g, x + 2, y + 2, "W");
}

/**
 * One frame of the kitchen as rows of palette characters ("." = empty).
 * @param {string} mood - a key of MOODS
 * @param {number} frame - any integer; taken mod FRAMES
 * @returns {string[][]} H rows of W palette characters
 */
export function scene(mood, frame) {
  if (!MOODS[mood]) throw new RangeError(`unknown mood: ${mood}`);
  const f = ((frame % FRAMES) + FRAMES) % FRAMES;
  const g = blank();
  stove(g);
  flames(g, MOODS[mood].flame, f);
  pot(g, MOODS[mood].food);
  bubbles(g, mood, f);
  steam(g, mood, f);
  chef(g, mood, f);
  return g;
}

// ── surfaces ───────────────────────────────────────────────────────────────

const DEFAULT = 0x01000000; // "the terminal's own color" in a Raster cell
const UPPER = 0x2580; // ▀
const LOWER = 0x2584; // ▄

/**
 * Pack a grid for a terminal `Raster`: two pixels per cell with half blocks,
 * so the art is W columns × H/2 rows.
 * @returns {{ columns: number, rows: number, cells: string }}
 */
export function rasterCells(grid) {
  const rows = Math.ceil(grid.length / 2);
  const cols = grid[0].length;
  const words = new Uint32Array(cols * rows * 3);
  let i = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let x = 0; x < cols; x++) {
      const top = COLORS[grid[cy * 2][x]];
      const bot = COLORS[grid[cy * 2 + 1]?.[x]];
      let cp = 0x20;
      let fg = DEFAULT;
      let bg = DEFAULT;
      if (top != null && bot != null) [cp, fg, bg] = [UPPER, top, bot];
      else if (top != null) [cp, fg] = [UPPER, top];
      else if (bot != null) [cp, fg] = [LOWER, bot];
      words[i++] = cp;
      words[i++] = fg;
      words[i++] = bg;
    }
  }
  return { columns: cols, rows, cells: toBase64(new Uint8Array(words.buffer)) };
}

function toBase64(bytes) {
  if (typeof bytes.toBase64 === "function") return bytes.toBase64();
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const hex = (n) => "#" + n.toString(16).padStart(6, "0");

/** One frame as compact SVG: a path per color, a run per row. */
function framePaths(grid) {
  const byColor = new Map();
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      if (COLORS[c] != null) {
        const d = byColor.get(c) || [];
        d.push(`M${x} ${y}h${end - x}v1h${x - end}z`);
        byColor.set(c, d);
      }
      x = end;
    }
  });
  return [...byColor].map(([c, d]) => `<path fill="${hex(COLORS[c])}" d="${d.join("")}"/>`).join("");
}

/**
 * An animated SVG of a mood's loop, for Desktop's `Svg` with
 * `isInteractive: true` (SMIL runs there; script never does).
 * @param {string} mood
 * @param {number} [scale] - CSS pixels per art pixel
 * @returns {string}
 */
export function svgFor(mood, scale = 5) {
  const n = FRAMES;
  const dur = (MOODS[mood].ms * n) / 1000;
  const keyTimes = Array.from({ length: n }, (_, i) => (i / n).toFixed(4)).join(";");
  const groups = Array.from({ length: n }, (_, i) => {
    const values = Array.from({ length: n }, (_, j) => (j === i ? 1 : 0)).join(";");
    return (
      `<g opacity="${i === 0 ? 1 : 0}">` +
      `<animate attributeName="opacity" values="${values}" keyTimes="${keyTimes}" ` +
      `calcMode="discrete" dur="${dur}s" repeatCount="indefinite"/>` +
      framePaths(scene(mood, i)) +
      `</g>`
    );
  }).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
    `width="${W * scale}" height="${H * scale}" shape-rendering="crispEdges">${groups}</svg>`
  );
}
