import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);

// L2 write flow — the "magical first five": write an entry and get a real reflection streamed back.
// Local-only: the deployed demo is read-only and must never be mutated by a test. Run a dev server
// pointed at a throwaway showcase user first, then this spec against it:
//   DB_HTTP=1 DEMO_PRIVY_ID=e2e-throwaway KNOLE_REQUIRE_AUTH=off npm run dev
//   E2E_BASE_URL=http://localhost:3000 npx playwright test journal --project=desktop
// (KNOLE_REQUIRE_AUTH=off opts the throwaway demo into writable — without it, the secure-by-default
//  guard correctly rejects the anonymous write with a "Sign in to start your own Knole" message.)
test.describe("write flow", () => {
  test.skip(!LOCAL, "needs a local dev server; the deployed demo is read-only");
  test.setTimeout(240_000); // the first reflection cold-starts the local embedding + NER models

  test("journal entry → streamed reflection", async ({ page }) => {
    await page.goto("/today", { waitUntil: "domcontentloaded" });

    const entry =
      "Today I finally booked the cabin trip I kept putting off — three nights by the lake in " +
      "October. It's the first thing in months I've done purely for myself, and it scares me a little.";
    const box = page.getByPlaceholder(/write what's true/i);
    await box.click();
    await box.press("ControlOrMeta+a"); // clear the hardcoded sample entry
    await box.press("Delete");
    await box.pressSequentially(entry, { delay: 8 }); // React controlled input — type, don't fill()
    await page.getByRole("button", { name: /^reflect$/i }).click();

    // The reflection streams into its own block. Assert it appears, grows into a real paragraph
    // (not just the first token), and is not the error fallback.
    const reflection = page.getByTestId("reflection");
    await expect(reflection).toBeVisible({ timeout: 240_000 });
    await expect
      .poll(async () => (await reflection.textContent())?.length ?? 0, { timeout: 240_000 })
      .toBeGreaterThan(80);
    await expect(reflection).not.toContainText(/something interrupted the reflection/i);
  });
});
