/**
 * The assembled popover UI must be self-contained (bogez/pace#16: the popover
 * *is* the web tracker). build-ui.mjs copies an explicit file list, so a new
 * module imported by the PWA but missing from the list ships a dist/ whose
 * import graph 404s inside the webview — killing the whole tracker module
 * silently (how #52's app/measured.js broke the beta.3 tray). This walks the
 * built dist/ and asserts every static relative import and every local
 * src/href in index.html resolves to a copied file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const builder = join(root, "apps", "tray", "build-ui.mjs");
const dist = join(root, "apps", "tray", "dist");

execFileSync(process.execPath, [builder], { encoding: "utf8" });

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

test("every static import in dist's module graph resolves", () => {
  const scripts = walk(dist).filter((p) => /\.(js|mjs)$/.test(p));
  assert.ok(scripts.length > 0, "dist contains no scripts — did build-ui run?");
  for (const file of scripts) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^import\s[^;]*?["'](\.[^"']+)["']/gm)) {
      const target = resolve(dirname(file), m[1]);
      assert.ok(
        existsSync(target),
        `${file} imports ${m[1]} but it was not copied — add it to build-ui.mjs`
      );
    }
  }
});

test("every local src/href in dist/index.html resolves", () => {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
    if (/^[a-z]+:/.test(m[1])) continue; // external URLs
    assert.ok(
      existsSync(join(dist, m[1])),
      `index.html references ${m[1]} but it was not copied — add it to build-ui.mjs`
    );
  }
});
