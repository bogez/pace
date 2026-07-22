#!/usr/bin/env node
/**
 * Assemble the popover frontend into dist/ from the PWA's own files — the
 * popover *is* the web tracker (bogez/pace#16: reuse, don't re-declare).
 * Copies exactly what index.html references; no bundler, no transforms.
 * The service worker is deliberately omitted: index.html skips registration
 * under Tauri, and the webview needs no offline shell.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const dist = join(here, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const p of [
  "index.html",
  "manifest.webmanifest",
  "app/tracker.css",
  "app/tracker.js",
  "app/window.js",
  "app/calibration.js",
  "app/tray-format.js",
  "app/tray.js",
  "app/icons/icon-192.png",
  "app/icons/icon-512.png",
  "src/pace.js",
  "sensors/weights.mjs",
]) {
  const dest = join(dist, p);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(root, p), dest);
}
console.log("popover UI assembled in", dist);
