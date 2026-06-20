import { test, expect } from "@playwright/test";

// L2 read flow (safe on the seeded demo): Ask My Life returns a grounded answer that quotes the
// user's own entries back as "receipts" — the product's core "never paraphrase without showing where
// it came from" promise, asserted end-to-end through the UI.
test("ask my life returns a grounded answer with receipts", async ({ page }) => {
  await page.goto("/ask", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /how do i usually talk about my mother/i }).click();
  // The throughline streams first; the cited receipts block follows. Generous timeout for cold start.
  await expect(page.getByText(/receipts/i)).toBeVisible({ timeout: 75_000 });
  await expect(page.getByText(/mother|mom/i).first()).toBeVisible();
});
