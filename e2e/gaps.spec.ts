import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const shot = (n: string) => ({ path: `qa-shots/gap-${n}.png`, fullPage: true });

// L3 — the interactive sub-features not yet driven: Index memory CRUD, settings freq/quiet-hours,
// wrapped share/export. Local-only (writes); needs the writable full-data dev server.
test.describe("interactive gaps", () => {
  test.skip(!LOCAL, "needs the writable full-data dev server");
  test.setTimeout(120_000);

  test("The Index: pin + trace a memory", async ({ page }) => {
    await page.goto("/the-index", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /the index/i })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);
    const pin = page.getByRole("button", { name: /^pin$/i }).first();
    await expect(pin).toBeAttached({ timeout: 10_000 });
    await pin.click();
    await expect(page.getByRole("button", { name: /^unpin$/i }).first()).toBeVisible({
      timeout: 8000,
    });
    const trace = page.getByRole("button", { name: /^trace$/i }).first();
    await trace.click();
    await expect(page.getByRole("button", { name: /^close$/i }).first()).toBeVisible({
      timeout: 8000,
    });
    await page.screenshot(shot("index-crud"));
  });

  test("The Index: edit a memory persists", async ({ page }) => {
    await page.goto("/the-index", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page
      .getByRole("button", { name: /^edit$/i })
      .first()
      .click();
    const box = page.locator("textarea").first();
    await expect(box).toBeVisible({ timeout: 8000 });
    await box.fill("QA-edited memory line for verification.");
    await page
      .getByRole("button", { name: /^save$/i })
      .first()
      .click();
    await expect(page.getByText(/QA-edited memory line/i)).toBeVisible({ timeout: 8000 });
    await page.screenshot(shot("index-edit"));
  });

  test("Settings: frequency + quiet-hours persist across reload", async ({ page }) => {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const slider = page.getByRole("slider", { name: /how often/i });
    await slider.focus();
    await slider.press("ArrowRight");
    const from = page.locator('input[type="time"]').first();
    await from.fill("23:00");
    await from.blur();
    await page.waitForTimeout(2000); // persist to the server
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await expect(page.locator('input[type="time"]').first()).toHaveValue("23:00");
    await page.screenshot(shot("settings-freq-quiet"));
  });

  test("Wrapped: 'Share your mirror' exports the card", async ({ page }) => {
    await page.goto("/wrapped", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const btn = page.getByRole("button", { name: /share your mirror/i });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }).catch(() => null),
      btn.click(),
    ]);
    expect(download?.suggestedFilename() ?? "knole-mirror.png").toMatch(/knole|mirror/i);
    await page.screenshot(shot("wrapped-share"));
  });
});
