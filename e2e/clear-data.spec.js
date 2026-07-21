/**
 * TRUST.md commitment 4, browser-verified (bogez/pace#7): "Clear all data"
 * actually clears everything, and leaving is verifiable.
 */
import { test, expect } from "@playwright/test";

const KEY = "pace.tracker.v1";

test("check-in persists, then Clear all data removes every trace", async ({ page }) => {
  await page.goto("/");

  // First-run state
  await expect(page.locator("#state-name")).toHaveText("no data yet");

  // Log a check-in → the meter answers
  await page.fill("#weekly-pct", "53");
  await page.click("#checkin-form button");
  await expect(page.locator("#state-name")).not.toHaveText("no data yet");
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).not.toBeNull();

  // Survives a reload (it's a tracker, not a toy)
  await page.reload();
  await expect(page.locator("#state-name")).not.toHaveText("no data yet");

  // Clear all data → storage empty, UI back to first-run
  page.on("dialog", (d) => d.accept());
  await page.click("#clear-data");
  await expect(page.locator("#state-name")).toHaveText("no data yet");
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test("declining the confirm keeps the data", async ({ page }) => {
  await page.goto("/");
  await page.fill("#weekly-pct", "40");
  await page.click("#checkin-form button");

  page.on("dialog", (d) => d.dismiss());
  await page.click("#clear-data");
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).not.toBeNull();
});
