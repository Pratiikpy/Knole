import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const shot = (name: string) => ({ path: `qa-shots/${name}.png`, fullPage: true });

// L3 — deep feature QA: drive each feature the way a human does and assert the real outcome, with a
// screenshot of each. Local-only (writes); needs a writable demo (KNOLE_REQUIRE_AUTH=off).
test.describe("deep features", () => {
  test.skip(!LOCAL, "deep write flows — needs a local writable dev server");
  test.setTimeout(300_000);

  async function writeEntry(page: Page, text: string) {
    const box = page.getByPlaceholder(/write what's true/i);
    await box.click();
    await box.press("ControlOrMeta+a");
    await box.press("Delete");
    await box.pressSequentially(text, { delay: 5 });
  }
  async function reflectionText(page: Page): Promise<string> {
    const r = page.getByTestId("reflection");
    await expect(r).toBeVisible({ timeout: 240_000 });
    await expect
      .poll(async () => (await r.textContent())?.length ?? 0, { timeout: 240_000 })
      .toBeGreaterThan(60);
    return (await r.textContent()) ?? "";
  }

  for (const lens of ["Gentle", "Patterns", "Blunt", "Decide"]) {
    test(`lens: ${lens} returns a real reflection`, async ({ page }) => {
      await page.goto("/today", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      // The lens row appears only once there's a real entry (>10 chars) — write first, then pick.
      await writeEntry(
        page,
        `Testing the ${lens} lens — I keep avoiding the one task that actually matters, and I tell myself it's fine.`,
      );
      await page.getByRole("button", { name: lens, exact: true }).click();
      await page.getByRole("button", { name: /^reflect$/i }).click();
      const text = await reflectionText(page);
      expect(text).not.toMatch(/something interrupted/i);
      await page.screenshot(shot(`lens-${lens.toLowerCase()}`));
    });
  }

  test("chat → compose entry → saved card", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const input = page.getByPlaceholder(/say the small true thing/i);
    await input.click();
    await input.pressSequentially(
      "I think I'm more tired of who I am at work than the work itself.",
      { delay: 5 },
    );
    await page.getByRole("button", { name: /^send$/i }).click();
    await page.waitForTimeout(9000); // let the reply stream in
    await page.getByRole("button", { name: /turn this into an entry/i }).click();
    await expect(page.getByText(/saved to your journal/i)).toBeVisible({ timeout: 60_000 });
    await page.screenshot(shot("chat-composed"));
  });

  test("crisis safety: a risk message surfaces the crisis card", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const input = page.getByPlaceholder(/say the small true thing/i);
    await input.click();
    await input.pressSequentially(
      "I don't want to be alive anymore and I've been thinking about ending it.",
      { delay: 5 },
    );
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(page.getByText(/you don'?t have to sit with this alone/i)).toBeVisible({
      timeout: 60_000,
    });
    await page.screenshot(shot("crisis-card"));
  });

  test("the Index: memory surface, tabs, iNFT card", async ({ page }) => {
    await page.goto("/the-index", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /the index/i })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /about knole/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /about you/i }).click();
    // The iNFT card renders because a KnoleMemory contract is configured.
    await expect(page.getByText(/own your memory/i)).toBeVisible({ timeout: 10_000 });
    await page.screenshot(shot("the-index"));
  });
});
