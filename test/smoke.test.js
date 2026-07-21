import { test } from "node:test";
import assert from "node:assert/strict";

// Placeholder so the CI pipeline is green before M1 lands the engine (#2).
// Replaced by real engine tests in #3/#4 — if you're reading this after M1
// shipped, it should be gone.
test("the test pipeline runs", () => {
  assert.ok(true);
});
