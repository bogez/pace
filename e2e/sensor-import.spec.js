/**
 * Sensor → PWA loop (bogez/pace#13): import, honest zero state, the check-in
 * as calibration act, estimated vs. measured presentation (TRUST.md
 * commitment 5), and clear-all wiping calibration too.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// weighted = 1M×1 + 300k×5 + 400k×1.25 + 0×0.1 = 3,000,000
const sensorJson = (weightedScale = 1, minutesAgo = 5) =>
  JSON.stringify({
    generatedAt: new Date(Date.now() - minutesAgo * 60e3).toISOString(),
    window: { weekStart: new Date(Date.now() - 24 * 36e5).toISOString() },
    week: {
      input: 1_000_000 * weightedScale,
      output: 300_000 * weightedScale,
      cacheWrite: 400_000 * weightedScale,
      cacheRead: 0,
      weighted: 3_000_000 * weightedScale,
      count: 10,
    },
  });

async function importSensor(page, json) {
  // <summary> clicks toggle — set open directly so repeat imports don't close it
  await page.evaluate(() => (document.getElementById("sensor-details").open = true));
  await page.fill("#sensor-paste", json);
  await page.click("#sensor-import");
}

test("the full loop: zero state → calibrate → estimated → measured wins", async ({ page }) => {
  await page.goto("/");

  // Import a snapshot before any calibration: raw tokens, never a percent.
  await importSensor(page, sensorJson(1));
  await expect(page.locator("#sensor-line")).toContainText("3.0M weighted tokens");
  await expect(page.locator("#sensor-line")).toContainText("calibrate");
  await expect(page.locator("#sensor-line")).not.toContainText("≈");
  await expect(page.locator("#state-name")).toHaveText("no data yet");

  // Check-in = calibration act (snapshot is 5 min old, well within pairing).
  await page.fill("#weekly-pct", "50");
  await page.click("#checkin-form button");
  await expect(page.locator("#sensor-line")).toContainText("Calibrated ✓");
  // Meter shows the MEASURED check-in (it's newer than the snapshot).
  await expect(page.locator("#delta-line")).toContainText("50% used");
  await expect(page.locator("#delta-line")).not.toContainText("≈");
  expect(await page.locator("#dot").getAttribute("class")).not.toContain("estimated");

  // A fresh snapshot arrives, 20% more tokens → estimate takes over: 60%.
  await importSensor(page, sensorJson(1.2, 0));
  await expect(page.locator("#delta-line")).toContainText("≈60% used (estimated)");
  await expect(page.locator("#source-line")).toContainText("Estimated from the Claude Code sensor");
  expect(await page.locator("#dot").getAttribute("class")).toContain("estimated");
  await expect(page.locator("#sensor-line")).toContainText("≈ 60%");

  // The estimated state is still accessible.
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // A new manual check-in instantly wins over the estimate.
  await page.fill("#weekly-pct", "58");
  await page.click("#checkin-form button");
  await expect(page.locator("#delta-line")).toContainText("58% used");
  await expect(page.locator("#delta-line")).not.toContainText("≈");
  expect(await page.locator("#dot").getAttribute("class")).not.toContain("estimated");
});

test("garbage input is refused with a message, state unharmed", async ({ page }) => {
  await page.goto("/");
  await importSensor(page, "not json at all");
  await expect(page.locator("#sensor-line")).toContainText("doesn't parse");
  await importSensor(page, JSON.stringify({ hello: 1 }));
  await expect(page.locator("#sensor-line")).toContainText("doesn't look like the sensor's output");
  await expect(page.locator("#state-name")).toHaveText("no data yet");
});

test("Clear all data wipes calibration and sensor state too", async ({ page }) => {
  await page.goto("/");
  await importSensor(page, sensorJson(1));
  await page.fill("#weekly-pct", "50");
  await page.click("#checkin-form button");

  page.on("dialog", (d) => d.accept());
  await page.click("#clear-data");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await expect(page.locator("#state-name")).toHaveText("no data yet");
});
