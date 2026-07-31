/**
 * Two live instances of the tracker — a second tab, the installed PWA
 * window, or the tray popover — share localStorage. A check-in logged in
 * one must appear in the other, and (the rollback bug) a later save from
 * the other instance must not overwrite it with a stale in-memory copy.
 */
import { test, expect } from "@playwright/test";

test("a check-in in one instance survives a save from another", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto("/");
  await b.goto("/");

  // Check in on A; B picks it up live via the storage event.
  await a.fill("#weekly-pct", "42");
  await a.click("#checkin-form button");
  await expect(b.locator("#delta-line")).toContainText("42% used");

  // Now make B save (log a session). Before the fix, B still held the state
  // it loaded at startup, so this write silently deleted A's check-in.
  const resets = await b.evaluate(() => {
    const d = new Date(Date.now() + 60 * 60e3); // an hour from now
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  await b.fill("#session-pct", "10");
  await b.fill("#session-resets", resets);
  await b.click("#session-form button");

  const stored = await b.evaluate(() => JSON.parse(localStorage.getItem("pace.tracker.v1")));
  expect(stored.checkins.map((c) => c.weeklyPct)).toContain(42);
  await expect(b.locator("#delta-line")).toContainText("42% used");
  // And the session flows back to A the same way.
  await expect(a.locator("#session-line")).toContainText("10% used");
});
