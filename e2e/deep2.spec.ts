import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const shot = (name: string) => ({ path: `qa-shots/${name}.png`, fullPage: true });

// L3 batch 2 — insights, settings persistence, future-self, and the wrapped/year/on-this-day
// surfaces. Local-only (one write: the settings change). Screenshots each.
test.describe("deep features 2", () => {
  test.skip(!LOCAL, "deep flows — needs a local writable dev server");
  test.setTimeout(180_000);

  test("insights: the Pattern Mirror renders with real content", async ({ page }) => {
    await page.goto("/insights", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/pattern mirror/i).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    await expect(page.locator("body")).toContainText(
      /your first mirror|throughline|what was on your mind|keep writing|needs a few more/i,
    );
    await page.screenshot(shot("insights"));
  });

  test("settings: voice change persists across reload", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.getByText("Warm & patient").click(); // non-default (default is structural)
    await page.waitForTimeout(1500); // persist to the server
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await expect(page.locator('input[name="voice"]').first()).toBeChecked();
    await page.screenshot(shot("settings"));
  });

  test("future self: ask a question → a reply streams", async ({ page }) => {
    await page.goto("/future", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const input = page.getByPlaceholder(/ask the thing you actually want to know/i);
    await input.click();
    await input.pressSequentially("Will I regret not taking the risk this year?", { delay: 5 });
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(page.getByText(/will i regret not taking the risk/i)).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(12000); // the future-self reply streams in
    await page.screenshot(shot("future-self"));
  });

  for (const [route, name] of [
    ["/wrapped", "wrapped"],
    ["/year", "year"],
    ["/on-this-day", "on-this-day"],
  ] as const) {
    test(`${route} renders real content`, async ({ page }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("body")).toContainText(/\S/);
      await page.screenshot(shot(name));
    });
  }
});
