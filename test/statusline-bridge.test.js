/**
 * Statusline bridge (bogez/pace#51): stdin JSON in → usage file + one
 * summary line out, and it must never break the statusline (exit 0 always).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const bridge = join(dirname(fileURLToPath(import.meta.url)), "..", "sensors", "statusline.mjs");
const out = join(mkdtempSync(join(tmpdir(), "pace-bridge-")), "nested", "usage.json");

const run = (input) =>
  execFileSync(process.execPath, [bridge, "--file", out], { input, encoding: "utf8" });

test("tees rate_limits to the file and prints a pace summary", () => {
  const stdout = run(
    JSON.stringify({
      model: { display_name: "Opus" }, // unrelated statusline fields pass through
      rate_limits: {
        seven_day: { used_percentage: 41.2, resets_at: Math.floor((Date.now() + 72 * 36e5) / 1000) },
        five_hour: { used_percentage: 23, resets_at: Math.floor((Date.now() + 2 * 36e5) / 1000) },
      },
    })
  );
  assert.match(stdout, /wk 41%/);
  assert.match(stdout, /5h 23%/);
  // 41% at ~96/168 h elapsed → delta ≈ −16 → a cool-side state with a glyph.
  assert.match(stdout, /▼|▽|●/);

  const teed = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(teed.source, "claude-code-statusline");
  assert.ok(Number.isFinite(Date.parse(teed.generatedAt)));
  assert.equal(teed.rate_limits.seven_day.used_percentage, 41.2);
  assert.equal(teed.model, undefined); // only rate_limits is persisted
});

test("no rate_limits (API-key user): waiting line, exit 0, no file churn", () => {
  const stdout = run(JSON.stringify({ model: { display_name: "Opus" } }));
  assert.match(stdout, /waiting for usage data/);
});

test("garbage stdin never breaks the statusline", () => {
  const stdout = run("not json at all");
  assert.match(stdout, /waiting for usage data/);
});
