/**
 * Measured usage from Claude Code's statusline (bogez/pace#51): imported
 * rate_limits JSON drives the meter in the *measured* style, arbitrates
 * with manual check-ins by recency, calibrates the sensor without typing,
 * and floors later estimates.
 */
import { test, expect } from "@playwright/test";

const statuslineJson = ({ weekPct, sessionPct, minutesAgo = 0, weekResetHours = 72 } = {}) =>
  JSON.stringify({
    generatedAt: new Date(Date.now() - minutesAgo * 60e3).toISOString(),
    rate_limits: {
      ...(weekPct != null && {
        seven_day: {
          used_percentage: weekPct,
          resets_at: Math.floor((Date.now() + weekResetHours * 36e5) / 1000),
        },
      }),
      ...(sessionPct != null && {
        five_hour: {
          used_percentage: sessionPct,
          resets_at: Math.floor((Date.now() + 2 * 36e5) / 1000),
        },
      }),
    },
  });

// weighted = 1M×1 + 300k×5 + 400k×1.25 = 3,000,000 (same fixture as sensor-import)
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

async function importJson(page, json) {
  await page.evaluate(() => (document.getElementById("sensor-details").open = true));
  await page.fill("#sensor-paste", json);
  await page.click("#sensor-import");
}

test("a statusline import drives the meter in the measured style", async ({ page }) => {
  await page.goto("/");
  await importJson(page, statuslineJson({ weekPct: 41, sessionPct: 23 }));

  // Weekly: measured, not estimated — no "≈", no dashed dot, named source.
  await expect(page.locator("#delta-line")).toContainText("41% used");
  await expect(page.locator("#delta-line")).not.toContainText("≈");
  expect(await page.locator("#dot").getAttribute("class")).not.toContain("estimated");
  await expect(page.locator("#source-line")).toContainText("Measured by Claude Code");
  await expect(page.locator("#age-line")).toContainText("Measured snapshot");

  // The window comes from resets_at: reset in 72 h → 96 h elapsed ≈ 57.1%.
  await expect(page.locator("#delta-line")).toContainText("57.1% expected");

  // Session auto-populates from five_hour, labeled as measured.
  await expect(page.locator("#session-line")).toContainText("23% used");
  await expect(page.locator("#session-line")).toContainText("measured by Claude Code");
});

test("recency arbitrates between check-ins and measured snapshots", async ({ page }) => {
  await page.goto("/");
  await page.fill("#weekly-pct", "30");
  await page.click("#checkin-form button");
  await expect(page.locator("#delta-line")).toContainText("30% used");

  // A newer measured snapshot wins over the older check-in.
  await importJson(page, statuslineJson({ weekPct: 44 }));
  await expect(page.locator("#delta-line")).toContainText("44% used");
  await expect(page.locator("#source-line")).toContainText("Measured by Claude Code");

  // A newer manual check-in wins right back (the correction channel).
  await page.fill("#weekly-pct", "46");
  await page.click("#checkin-form button");
  await expect(page.locator("#delta-line")).toContainText("46% used");
  await expect(page.locator("#source-line")).not.toContainText("Measured by Claude Code");
});

test("measured snapshots calibrate the sensor and floor later estimates", async ({ page }) => {
  await page.goto("/");
  // Seed a deliberately-high K: W = 3.0M at a typed 25% → K = 120k.
  await importJson(page, sensorJson(1));
  await page.fill("#weekly-pct", "25");
  await page.click("#checkin-form button");
  await expect(page.locator("#sensor-line")).toContainText("Calibrated ✓");

  // A measured 50% calibrates without typing: K_obs = 60k → K = 90k.
  await importJson(page, statuslineJson({ weekPct: 50 }));
  await expect(page.locator("#sensor-line")).toContainText("Calibrated");
  await expect(page.locator("#delta-line")).toContainText("50% used");

  // Fresh sensor snapshot, more tokens: naive estimate 3.6M / 90k = 40% —
  // below the measured 50%, which is impossible. The measurement floors it.
  await importJson(page, sensorJson(1.2, 0));
  await expect(page.locator("#delta-line")).toContainText("≈50% used (estimated)");
});

test("a snapshot whose own week already reset is not used", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    // Stored snapshot from before its window boundary: resets_at has passed.
    localStorage.setItem(
      "pace.measured.v1",
      JSON.stringify({
        t: Date.now() - 2 * 36e5,
        weekly: { pct: 88, resetsAt: Date.now() - 36e5 },
        session: null,
      })
    );
  });
  await page.reload();
  await expect(page.locator("#state-name")).toHaveText("no data yet");
});

test("Clear all data wipes the measured snapshot too", async ({ page }) => {
  await page.goto("/");
  await importJson(page, statuslineJson({ weekPct: 41, sessionPct: 23 }));
  page.on("dialog", (d) => d.accept());
  await page.click("#clear-data");
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await expect(page.locator("#state-name")).toHaveText("no data yet");
});
