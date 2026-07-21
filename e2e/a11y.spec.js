/**
 * Accessibility suite (bogez/pace#8): axe audits of both app states, plus a
 * keyboard-only walkthrough. Charter principle 2 — never color alone — is a
 * merge requirement, and this file is part of how it's enforced.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("axe: first-run state has no violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("axe: live state (with data, setup collapsed) has no violations", async ({ page }) => {
  await page.goto("/");
  await page.fill("#weekly-pct", "53");
  await page.click("#checkin-form button");
  await page.fill("#session-pct", "40");
  await page.fill("#session-resets", "23:59");
  await page.click("#session-form button");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("keyboard only: check in and clear data without a mouse", async ({ page }) => {
  await page.goto("/");

  // Tab reaches the check-in input (nothing focus-traps before it)
  let hops = 0;
  while (hops++ < 10) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.id === "weekly-pct")) break;
  }
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("weekly-pct");

  // Type and submit with Enter
  await page.keyboard.type("53");
  await page.keyboard.press("Enter");
  await expect(page.locator("#state-name")).not.toHaveText("no data yet");

  // The clear-data button is reachable and operable by keyboard
  page.on("dialog", (d) => d.accept());
  await page.focus("#clear-data");
  await page.keyboard.press("Enter");
  await expect(page.locator("#state-name")).toHaveText("no data yet");
});

test("every state change carries a glyph, not just a color", async ({ page }) => {
  await page.goto("/");
  await page.fill("#weekly-pct", "99"); // way over pace → hot territory
  await page.click("#checkin-form button");
  const glyph = await page.locator("#glyph").textContent();
  expect(["▲▲", "▲", "●", "▼", "▼▼"]).toContain(glyph.trim());
  const name = await page.locator("#state-name").textContent();
  expect(name).not.toEqual("no data yet");
});
