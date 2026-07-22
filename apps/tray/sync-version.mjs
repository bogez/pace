#!/usr/bin/env node
/**
 * Stamp the tray app's version from a release tag (bogez/pace#44), so
 * installer filenames can never drift from the release they ship under.
 *
 * Usage: node sync-version.mjs v0.4.0-beta.1   (or reads GITHUB_REF_NAME)
 *
 * Only the numeric core is written (v0.4.0-beta.1 → 0.4.0): Windows MSI
 * product versions must be numeric x.y.z, so the pre-release suffix stays in
 * the tag and release name, where it already lives.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const tag = process.argv[2] || process.env.GITHUB_REF_NAME || "";
const m = tag.match(/^v(\d+\.\d+\.\d+)(-|$)/);
if (!m) {
  console.error(`sync-version: "${tag}" is not a vX.Y.Z tag — nothing written`);
  process.exit(1);
}
const version = m[1];

const conf = join(dirname(fileURLToPath(import.meta.url)), "src-tauri", "tauri.conf.json");
const c = JSON.parse(readFileSync(conf, "utf8"));
c.version = version;
writeFileSync(conf, JSON.stringify(c, null, 2) + "\n");
console.log(`sync-version: tauri.conf.json version ← ${version} (from ${tag})`);
