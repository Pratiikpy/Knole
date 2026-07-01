import { test, expect } from "@playwright/test";
const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const shot = (n: string) => ({ path: `qa-shots/gap-${n}.png`, fullPage: true });

// L3 — the proactive Nudge card (the "Dot-killer" reach-out) renders on Today when a nudge fires.
test("Today surfaces the proactive nudge card", async ({ page }) => {
  test.skip(!LOCAL, "needs the well-memoried dev server");
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000); // the nudge fetches async (LLM-generated)
  await expect(
    page
      .getByText(/thinking of you|on my mind|been a while|wondering|check in|noticed|been feeling/i)
      .first(),
  ).toBeVisible({ timeout: 40_000 });
  await page.screenshot(shot("nudge"));
});
