import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const shot = (n: string) => ({ path: `qa-shots/gap-${n}.png`, fullPage: true });

// L3 — the last two surfacing gaps: the Dream card (seeded dreaming artifact) and the MemoryPill
// recall receipt (a memory-matching reflection). Local-only; needs the writable full-data server.
test.describe("interactive gaps 2", () => {
  test.skip(!LOCAL, "needs the writable full-data dev server");
  test.setTimeout(180_000);

  test("Insights shows the Dream card", async ({ page }) => {
    await page.goto("/insights", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await expect(page.getByText(/last night knole noticed/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/marathon and to the firm/i)).toBeVisible({ timeout: 10_000 });
    await page.screenshot(shot("dream"));
  });

  test("MemoryPill: a recall receipt appears on a memory-matching reflection", async ({ page }) => {
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const box = page.getByPlaceholder(/write what's true/i);
    await box.click();
    await box.press("ControlOrMeta+a");
    await box.press("Delete");
    await box.pressSequentially(
      "I keep thinking about leaving my job at the firm — that decision still weighs on me sometimes.",
      { delay: 5 },
    );
    await page.getByRole("button", { name: /^reflect$/i }).click();

    const reflection = page.getByTestId("reflection");
    await expect(reflection).toBeVisible({ timeout: 120_000 });
    await expect
      .poll(async () => (await reflection.textContent())?.length ?? 0, { timeout: 120_000 })
      .toBeGreaterThan(60);

    const pill = page.getByRole("button", { name: /why/i }).first();
    await expect(pill).toBeVisible({ timeout: 20_000 });
    await pill.click();
    await expect(page.getByText(/recall · with receipts/i)).toBeVisible({ timeout: 8000 });
    await page.screenshot(shot("memory-pill"));
  });
});
