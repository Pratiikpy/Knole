import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);

// L2 — the core daily-use journey, end to end, exactly as a returning user moves through Knole:
// check in → write an entry → get a real reflection → land on the Index. Local-only (writes); needs a
// writable demo dev server:  DEMO_PRIVY_ID=e2e-throwaway KNOLE_REQUIRE_AUTH=off npm run dev
test.describe("core journey", () => {
  test.skip(!LOCAL, "write flow — needs a local writable dev server");
  test.setTimeout(300_000); // first reflection cold-starts the embedding + NER models

  test("check in → journal → reflect → the Index", async ({ page }) => {
    await page.goto("/today", { waitUntil: "domcontentloaded" });

    // 1. The daily check-in.
    await page.getByRole("button", { name: "good", exact: true }).click();
    await expect(page.getByText(/Logged.*Knole's got it/i)).toBeVisible({ timeout: 30_000 });

    // 2. Write a real entry (controlled input — clear the sample, then type).
    const entry =
      "I keep circling the same worry about the move, but writing it down it feels smaller — " +
      "maybe I'm more ready than the fear lets me admit.";
    const box = page.getByPlaceholder(/write what's true/i);
    await box.click();
    await box.press("ControlOrMeta+a");
    await box.press("Delete");
    await box.pressSequentially(entry, { delay: 6 });

    // 3. Reflect — a real reflection streams back, not the error fallback.
    await page.getByRole("button", { name: /^reflect$/i }).click();
    const reflection = page.getByTestId("reflection");
    await expect(reflection).toBeVisible({ timeout: 240_000 });
    await expect
      .poll(async () => (await reflection.textContent())?.length ?? 0, { timeout: 240_000 })
      .toBeGreaterThan(80);
    await expect(reflection).not.toContainText(/something interrupted/i);

    // 4. The memory surface renders.
    await page.goto("/the-index", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /the index/i })).toBeVisible({
      timeout: 30_000,
    });
  });
});
