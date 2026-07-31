#!/usr/bin/env node
/**
 * pace bridge: Claude Code statusline → measured usage file (bogez/pace#51).
 *
 * Claude Code invokes the configured statusline command with session JSON on
 * stdin (documented: https://code.claude.com/docs/en/statusline). For Pro/Max
 * subscribers that JSON carries rate_limits.{five_hour,seven_day} with
 * used_percentage and resets_at — the exact numbers /usage shows. This bridge
 * does two things:
 *
 *   1. tees { generatedAt, rate_limits } to ~/.pace/usage.json (override with
 *      --file or $PACE_USAGE_FILE) for the tray app to auto-read and the PWA
 *      to import, and
 *   2. prints a one-line pace summary, so the statusline itself becomes a
 *      pace meter.
 *
 * Setup (~/.claude/settings.json):
 *   { "statusLine": { "type": "command",
 *       "command": "node /path/to/pace/sensors/statusline.mjs" } }
 *
 * Trust (TRUST.md commitment 1): reads nothing but stdin; writes only its own
 * output file; no network, no credentials, nothing leaves the machine. The
 * statusline JSON is official, documented Claude Code behavior — no token
 * replay, no undocumented endpoints. The trust suite scans this file.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { paceDelta, paceState } from "../src/pace.js";
import { WEEK_HOURS, SESSION_HOURS } from "../app/window.js";

const args = process.argv.slice(2);
const fileArg = args[args.indexOf("--file") + 1];
const FILE =
  (args.includes("--file") && fileArg) ||
  process.env.PACE_USAGE_FILE ||
  join(homedir(), ".pace", "usage.json");

/** Epoch normalizer: the statusline docs specify seconds; tolerate ms. */
const toMs = (v) => (Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : null);

/** One window's summary fragment: pace glyph+state when the reset is known. */
function fragment(label, w, lengthHours) {
  const pct = w?.used_percentage;
  if (!Number.isFinite(pct)) return null;
  let text = `${label} ${Math.round(pct)}%`;
  const resetMs = toMs(w.resets_at);
  if (resetMs != null && resetMs > Date.now()) {
    const elapsed = lengthHours - (resetMs - Date.now()) / 36e5;
    if (elapsed > 0) {
      const st = paceState(paceDelta(pct, elapsed, lengthHours));
      text = `${st.glyph} ${st.name} · ${text}`;
    }
  }
  return text;
}

// A statusline command must never break the statusline: parse defensively,
// write best-effort, always print a line, always exit 0.
let doc = null;
try {
  doc = JSON.parse(readFileSync(0, "utf8"));
} catch {
  /* no stdin, or not JSON — fall through to the waiting line */
}

const rl = doc?.rate_limits;
const parts = [];
if (rl && typeof rl === "object") {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(
      FILE,
      JSON.stringify(
        {
          source: "claude-code-statusline",
          generatedAt: new Date().toISOString(),
          rate_limits: rl,
        },
        null,
        2
      ) + "\n"
    );
  } catch {
    /* an unwritable file must not break the statusline */
  }
  const wk = fragment("wk", rl.seven_day, WEEK_HOURS);
  if (wk) parts.push(wk);
  const s = fragment("5h", rl.five_hour, SESSION_HOURS);
  if (s) parts.push(s);
}

console.log(parts.length ? `pace ${parts.join(" · ")}` : "pace: waiting for usage data");
