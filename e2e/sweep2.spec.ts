import { test, expect } from "@playwright/test";
import { captureConsole } from "./helpers/console";

const shot = (name: string) => ({ path: `qa-shots/dark-${name}.png`, fullPage: true });
const DARK_ROUTES = [
  "/",
  "/today",
  "/chat",
  "/ask",
  "/insights",
  "/the-index",
  "/settings",
  "/future",
  "/year",
  "/wrapped",
  "/on-this-day",
];

// L0 in DARK — pre-set the Night theme, then sweep: every route renders console-clean in dark mode,
// and <html> actually carries .dark. Guards the whole product's dark theme, not just one page.
test.describe("dark mode sweep", () => {
  test.use({ colorScheme: "dark" });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("knole-theme", "dark"));
  });

  for (const route of DARK_ROUTES) {
    test(`dark ${route} renders console-clean`, async ({ page }) => {
      const { errors } = captureConsole(page);
      const resp = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(resp?.status(), `${route} status`).toBeLessThan(400);
      await page.waitForTimeout(2000);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.locator("body")).toContainText(/\S/);
      expect(errors, `dark ${route} console errors:\n${errors.join("\n")}`).toEqual([]);
    });
  }

  test("capture key dark screenshots", async ({ page }) => {
    for (const [route, name] of [
      ["/today", "today"],
      ["/insights", "insights"],
      ["/the-index", "index"],
    ] as const) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await page.screenshot(shot(name));
    }
  });
});

// L1 — the primary Shell navigation reaches every core surface (the way a user clicks around).
test("primary nav reaches every surface", async ({ page }) => {
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  for (const [name, urlPart] of [
    [/ask my life/i, "ask"],
    [/pattern mirror/i, "insights"],
    [/future self/i, "future"],
    [/^chat$/i, "chat"],
    [/^today$/i, "today"],
  ] as const) {
    await page.getByRole("link", { name }).first().click();
    await expect(page).toHaveURL(new RegExp(urlPart));
    await page.waitForTimeout(300);
  }
});
