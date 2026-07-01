import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const shot = (name: string) => ({ path: `qa-shots/${name}.png`, fullPage: true });

// L3 — the data-dependent cards, verified against a SEEDED user (a year-ago entry for on-this-day, a
// dropped "running" topic for the omission radar, valenced entries for the mood graph). Local-only.
test.describe("data-dependent cards (seeded)", () => {
  test.skip(!LOCAL, "needs the local seeded writable server");
  test.setTimeout(90_000);

  test("Today surfaces the on-this-day card (seeded year-ago entry)", async ({ page }) => {
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500); // the cards fetch async on load
    await expect(page.getByRole("link", { name: /see it/i })).toBeVisible({ timeout: 30_000 });
    await page.screenshot(shot("today-cards"));
  });

  test("Insights renders the Pattern Mirror + mood graph with seeded data", async ({ page }) => {
    await page.goto("/insights", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await expect(page.getByText(/pattern mirror/i).first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot(shot("insights-mood"));
  });
});
