/**
 * Staleness visibility (bogez/pace#9): a user who hasn't checked in for days
 * cannot mistake the display for current truth. Tiers: fresh ≤12h, aging ≤24h,
 * stale beyond — agreed in the issue thread before implementation.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const KEY = "pace.tracker.v1";

/**
 * Seed a check-in `ageHours` old, with the weekly reset pinned far enough back
 * that the check-in is inside the current window regardless of when CI runs.
 */
function seed(ageHours) {
  return (args) => {
    const [key, age] = args;
    const now = new Date();
    const resetDow = (now.getDay() + 1) % 7; // yesterday+? → last reset ~6 days ago
    localStorage.setItem(
      key,
      JSON.stringify({
        resetDow,
        resetHour: 0,
        checkins: [{ t: Date.now() - age * 36e5, weeklyPct: 50 }],
        session: null,
      })
    );
  };
}

test("fresh (2 h): age visible, no hedging", async ({ page }) => {
  await page.addInitScript(seed(2), [KEY, 2]);
  await page.goto("/");
  await expect(page.locator("#age-line")).toContainText("ago");
  await expect(page.locator("#age-line")).not.toContainText("◌");
  await expect(page.locator("#state-name")).not.toContainText("probably");
  expect(await page.locator("#dot").getAttribute("class")).not.toContain("stale");
});

test("aging (18 h): nudge appears, color still confident", async ({ page }) => {
  await page.addInitScript(seed(18), [KEY, 18]);
  await page.goto("/");
  await expect(page.locator("#age-line")).toContainText("◌");
  await expect(page.locator("#age-line")).toContainText("worth a fresh look");
  await expect(page.locator("#state-name")).not.toContainText("probably");
  expect(await page.locator("#dot").getAttribute("class")).not.toContain("stale");
});

test("stale (48 h): every channel degrades and says 'guess'", async ({ page }) => {
  await page.addInitScript(seed(48), [KEY, 48]);
  await page.goto("/");
  await expect(page.locator("#age-line")).toContainText("guess");
  await expect(page.locator("#state-name")).toContainText("probably");
  expect(await page.locator("#dot").getAttribute("class")).toContain("stale");
  await expect(page.locator("#forecast-line")).toContainText("Based on a check-in");

  // The glyph survives — direction is still our best guess (never color alone)
  const glyph = (await page.locator("#glyph").textContent()).trim();
  expect(["▲▲", "▲", "●", "▼", "▼▼"]).toContain(glyph);

  // And the degraded state is still accessible
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
