#!/usr/bin/env node
/**
 * Regenerate test/fixtures/claude-code/expected.json — the cross-implementation
 * contract between the JS transcript parser (the reference) and the tray app's
 * Rust port (docs/design/tray-sensor.md). Run after any deliberate parser or
 * fixture change; both test suites compare against this file, so a change here
 * is a contract change and deserves the same scrutiny as one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscripts } from "../sensors/parse-transcripts.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "claude-code");
const files = ["week-main.jsonl", "week-other.jsonl"];
const texts = files.map((f) => readFileSync(join(dir, f), "utf8"));

const weekStart = new Date("2026-07-16T05:00:00.000Z");
const sessionStart = new Date("2026-07-21T07:00:00.000Z");
const result = parseTranscripts(texts, { weekStart, sessionStart });

const doc = {
  _comment:
    "Cross-implementation contract (bogez/pace#15): both the JS parser and the Rust port " +
    "must reproduce result exactly from files under the given windows. " +
    "Regenerate only via scripts/gen-expected.mjs.",
  weekStart: weekStart.toISOString(),
  sessionStart: sessionStart.toISOString(),
  files,
  result,
};
writeFileSync(join(dir, "expected.json"), JSON.stringify(doc, null, 2) + "\n");
console.log("wrote expected.json");
