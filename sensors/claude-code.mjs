#!/usr/bin/env node
/**
 * pace sensor: Claude Code local transcripts — CLI wrapper (bogez/pace#11).
 *
 * Reads ~/.claude/projects/**\/*.jsonl (written by Claude Code for every
 * session) and aggregates token usage into the current weekly and 5-hour
 * windows. Zero dependencies, read-only, fully local — no network, no
 * credentials, nothing leaves the machine (TRUST.md commitments 1 & 2; the
 * trust suite scans this file).
 *
 * All parsing lives in parse-transcripts.mjs (pure, fixture-tested); this
 * wrapper only enumerates files, reads them, and formats output.
 *
 * Usage:
 *   node sensors/claude-code.mjs                   # human summary
 *   node sensors/claude-code.mjs --json            # machine-readable
 *   node sensors/claude-code.mjs --dir /path       # override ~/.claude
 *   node sensors/claude-code.mjs --reset-dow 4 --reset-hour 5
 *
 * The weighted totals are a quota-cost estimate for Claude Code only — chat
 * on claude.ai is invisible to local files. Calibrate against /usage per
 * docs/design/calibration.md.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseTranscripts } from "./parse-transcripts.mjs";
import { WEIGHTS_VERSION } from "./weights.mjs";
import { lastWeeklyReset, WEEK_HOURS, SESSION_HOURS } from "../app/window.js";

/* ---------------- args ---------------- */
const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
};
const JSON_OUT = args.includes("--json");
const ROOT = getArg("--dir", join(homedir(), ".claude"));
const RESET_DOW = +getArg("--reset-dow", 4); // Thursday
const RESET_HOUR = +getArg("--reset-hour", 5); // 5 AM local

/* ---------------- enumerate & read ---------------- */
function* jsonlFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

const now = new Date();
const weekStart = lastWeeklyReset(now, RESET_DOW, RESET_HOUR);
const sessionStart = new Date(now - SESSION_HOURS * 3600e3); // rolling approximation

let files = 0;
function* fileTexts() {
  for (const file of jsonlFiles(join(ROOT, "projects"))) {
    // skip files last modified before the window — their events can't be in it
    try {
      if (statSync(file).mtime < weekStart) continue;
    } catch {
      continue;
    }
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    files++;
    yield text;
  }
}

const { week, session, byModel, hourly, events } = parseTranscripts(fileTexts(), {
  weekStart,
  sessionStart,
});

/* ---------------- output ---------------- */
const elapsedH = (now - weekStart) / 36e5;
const ratePerHour = elapsedH > 0 ? week.weighted / elapsedH : 0;
const result = {
  generatedAt: now.toISOString(),
  weightsVersion: WEIGHTS_VERSION,
  window: {
    weekStart: weekStart.toISOString(),
    elapsedHours: +elapsedH.toFixed(2),
    elapsedPct: +((elapsedH / WEEK_HOURS) * 100).toFixed(1),
  },
  files,
  events,
  week,
  session,
  byModel,
  burn: {
    weightedPerHour: Math.round(ratePerHour),
    projectedWeekTotal: Math.round(ratePerHour * WEEK_HOURS),
  },
  hourly,
  note:
    "Weighted tokens are a quota-cost estimate for Claude Code only. " +
    "Calibrate against /usage — see docs/design/calibration.md.",
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const M = (n) =>
    n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
  console.log(`Pace · Claude Code sensor — ${now.toLocaleString()}`);
  console.log(
    `Weekly window since ${weekStart.toLocaleString()} (${result.window.elapsedPct}% elapsed)`
  );
  console.log(`Scanned ${files} transcript file(s), ${events} API responses\n`);
  console.log(
    `This week : in ${M(week.input)} · out ${M(week.output)} · cacheW ${M(week.cacheWrite)} · cacheR ${M(week.cacheRead)} → weighted ${M(week.weighted)}`
  );
  console.log(`Last 5 h  : in ${M(session.input)} · out ${M(session.output)} → weighted ${M(session.weighted)}`);
  for (const [model, s] of Object.entries(byModel))
    console.log(`  ${model}: ${s.count} responses, weighted ${M(s.weighted)}`);
  console.log(
    `\nBurn rate : ~${M(result.burn.weightedPerHour)} weighted/hour → projected ${M(result.burn.projectedWeekTotal)} by reset`
  );
}
