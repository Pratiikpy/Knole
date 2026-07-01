import { test, expect } from "@playwright/test";
import { captureConsole } from "./helpers/console";

// The L0 sweep: every public/app route renders, returns a non-error status, shows real content, and
// logs zero console errors — run across both the desktop and mobile projects from the config. This
// codifies the manual human-QA screen sweep so it can't silently regress.
const ROUTES = [
  "/",
  "/onboarding",
  "/today",
  "/chat",
  "/ask",
  "/insights",
  "/the-index",
  "/remembered",
  "/settings",
  "/extension",
  "/upgrade",
  "/future",
  "/on-this-day",
  "/wrapped",
  "/year",
];

for (const route of ROUTES) {
  test(`L0 ${route} renders console-clean`, async ({ page }) => {
    const { errors } = captureConsole(page);
    const resp = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(resp?.status(), `${route} should not return an HTTP error`).toBeLessThan(400);
    await page.waitForTimeout(2000); // SPA hydration soak
    await expect(page.locator("body"), `${route} should render content`).toContainText(/\S/);
    expect(errors, `${route} console errors:\n${errors.join("\n")}`).toEqual([]);
  });
}
