import { test, expect } from "@playwright/test";

// Negative / token-spend gate: empty or whitespace-only input must not fire an Ask query. The submit
// handler trims (`!text.trim()` → no-op) and the backend validates 1–500 chars, so a whitespace
// "Ask" click produces no answer surface and spends no LLM call.
test("ask gates whitespace input — no query fired", async ({ page }) => {
  await page.goto("/ask", { waitUntil: "domcontentloaded" });
  const input = page.getByPlaceholder(/ask anything/i);
  await input.fill("   ");
  // Submit via Enter (the form's onSubmit) — same trim-gate as the button, but viewport-robust: the
  // button is conditionally rendered (`{q && …}`) and clicking it under mobile emulation is flaky.
  await input.press("Enter");
  // No answer surface should appear for a whitespace query. Assert on "throughline" — the answer's
  // section label — not "receipts", which also appears in the always-present page heading.
  await page.waitForTimeout(2500);
  await expect(page.getByText(/throughline/i)).toHaveCount(0);
});
