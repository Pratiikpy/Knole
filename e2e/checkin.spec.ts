import { test, expect } from "@playwright/test";

// L1 — the one-tap daily check-in (the retention floor). A user opens Today and taps a single mood;
// it logs instantly (optimistic) with NO question gauntlet. The ack is client-side, so it's safe
// against any base URL. A short soak lets React hydrate before the tap (the SSR markup paints first).
test.describe("daily check-in", () => {
  test.setTimeout(60_000);

  async function openToday(page: import("@playwright/test").Page) {
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/how's today landing/i)).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500); // hydration soak — the onClick handler must be attached
  }

  test("tap a mood → logged, no gauntlet", async ({ page }) => {
    await openToday(page);
    await page.getByRole("button", { name: "good", exact: true }).click();
    await expect(page.getByText(/Logged.*Knole's got it/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "heavy", exact: true })).toHaveCount(0);
  });

  test("an optional note can ride along with the mood", async ({ page }) => {
    await openToday(page);
    await page
      .getByPlaceholder(/anything on your mind/i)
      .fill("quietly proud of a small thing today");
    await page.getByRole("button", { name: "bright", exact: true }).click();
    await expect(page.getByText(/Logged.*Knole's got it/i)).toBeVisible({ timeout: 15_000 });
  });
});
