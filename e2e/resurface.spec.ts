import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const shot = (n: string) => ({ path: `qa-shots/gap-${n}.png`, fullPage: true });

// L3 — the resurface card ("Knole brought something back"): the earliest thing you wrote, surfaced
// when there's no on-this-day match. Needs a user with old entries but no anniversary match.
test("Today surfaces the resurface card", async ({ page }) => {
  test.skip(!LOCAL, "needs the resurface-seeded dev server");
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500); // the cards fetch async on load
  await expect(page.getByText(/knole brought something back/i)).toBeVisible({ timeout: 30_000 });
  await page.screenshot(shot("resurface"));
});
