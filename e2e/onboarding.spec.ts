import { test, expect } from "@playwright/test";

const LOCAL = /localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL ?? "");

// The magical-first-5 (BUILD_PLAN M6): a not-signed-in visitor must get a REAL first reflection — the
// aha — not a sign-in wall. Drives the guest onboarding to the reflection step and asserts the auth
// gate is absent and the ephemeral reflection + honest "sign in to keep it" close appear.
//
// Local-only: needs a gated build carrying the fix, plus the LLM (the reflection is generated live).
test("onboarding delivers the no-signup aha to a guest", async ({ page }) => {
  test.skip(!LOCAL, "no-signup aha — runs against a local gated build with the LLM");
  test.setTimeout(120_000); // the first reflection cold-starts the local embedding + NER models

  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
  // The opener is a controlled textarea — focus, then type with a per-key delay. A delay-less
  // pressSequentially (or a bulk fill()) doesn't drive React's onChange reliably, so the state never
  // enables Continue.
  const opener = page.getByPlaceholder(/something small or something heavy/i);
  await opener.click();
  await opener.pressSequentially("I keep putting off the things that matter to me.", { delay: 8 });
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByRole("button", { name: /structural & clear/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByRole("button", { name: /something i keep avoiding/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();

  // The ephemeral aha: the honest "sign in to keep it" close appears once the reflection generates
  // (generous timeout — the model may cold-start).
  await expect(page.getByText(/sign in to keep it/i)).toBeVisible({ timeout: 40000 });
  // And it is NOT the auth gate — the gated-write message must be absent.
  await expect(page.getByText(/sign in to start your own knole/i)).toHaveCount(0);
});
