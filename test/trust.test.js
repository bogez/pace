/**
 * Trust suite (bogez/pace#7): CI enforcement of TRUST.md's machine-checkable
 * commitments. A PR that violates one fails here, with a message pointing at
 * the commitment it breaks.
 *
 * Checked:
 *  - Commitment 2 (all data stays on device): no network APIs anywhere in the
 *    app; the service worker's fetch handling is same-origin-guarded; no page
 *    resource loads from an external origin.
 *  - Commitment 3 (engine zero dependencies): no runtime deps in package.json,
 *    no imports in the engine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const APP_FILES = ["index.html", "app/tracker.js", "app/window.js", "src/pace.js", "sw.js"];
const SENSOR_FILES = [
  "sensors/claude-code.mjs",
  "sensors/parse-transcripts.mjs",
  "sensors/weights.mjs",
];

// Network APIs that must not appear anywhere in shipped code. `fetch` is
// special-cased: sw.js needs it to serve the app shell, under a guard.
const FORBIDDEN = ["XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "importScripts"];

test("TRUST 2: no network APIs in any shipped file", () => {
  for (const file of [...APP_FILES, ...SENSOR_FILES]) {
    const text = read(file);
    for (const api of FORBIDDEN) {
      assert.ok(
        !text.includes(api),
        `${file} contains ${api} — TRUST.md commitment 2 (all data stays on your device)`
      );
    }
    if (file !== "sw.js") {
      assert.ok(
        !/\bfetch\s*\(/.test(text),
        `${file} calls fetch() — TRUST.md commitment 2. Only sw.js may fetch (same-origin shell).`
      );
    }
  }
});

test("TRUST 2: the service worker only touches same-origin requests", () => {
  const sw = read("sw.js");
  assert.ok(
    sw.includes("url.origin !== self.location.origin"),
    "sw.js lost its same-origin guard — TRUST.md commitment 2"
  );
});

test("TRUST 2: no page resource loads from an external origin", () => {
  const html = read("index.html");
  // Resource-loading attributes must be relative. Absolute URLs are allowed
  // only on <a href> (navigation the user clicks, e.g. the Source link).
  for (const [, tag, attr, url] of html.matchAll(
    /<(script|link|img|iframe|source|audio|video)\b[^>]*?\b(src|href)\s*=\s*"([^"]+)"/g
  )) {
    assert.ok(
      !/^(https?:)?\/\//i.test(url),
      `<${tag} ${attr}="${url}"> loads from an external origin — TRUST.md commitment 2`
    );
  }
});

test("TRUST 1: sensors are read-only — no write or delete APIs", () => {
  // The sensor may read local transcripts the user already owns; it must
  // never write, delete, or spawn anything.
  const WRITE_APIS = [
    "writeFileSync", "appendFileSync", "createWriteStream", "writeFile",
    "unlink", "rmSync", "rmdir", "mkdir", "rename", "spawn", "exec",
  ];
  for (const file of SENSOR_FILES) {
    const text = read(file);
    for (const api of WRITE_APIS) {
      assert.ok(
        !text.includes(api),
        `${file} contains ${api} — sensors are read-only (TRUST.md commitment 1)`
      );
    }
  }
});

test("TRUST 3: no runtime dependencies, ever", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(
    pkg.dependencies,
    undefined,
    "package.json gained runtime dependencies — TRUST.md commitment 3"
  );
});

test("TRUST 3: the engine imports nothing", () => {
  assert.ok(
    !/^\s*import\s/m.test(read("src/pace.js")),
    "src/pace.js gained an import — the engine is dependency-free by charter principle 4"
  );
});
