import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const shot = (n: string) => ({ path: `qa-shots/wallet-${n}.png`, fullPage: true });

// L4 — the real Privy login modal: drive onboarding to the sign-in button, open Privy, and inspect
// what auth methods it offers (email vs wallet) so we know whether an injected wallet can finish it.
test("Privy login modal opens and exposes its methods", async ({ page }) => {
  test.skip(!LOCAL, "real Privy modal — needs local auth-on dev server");
  test.setTimeout(180_000);

  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
  const opener = page.getByPlaceholder(/something small or something heavy/i);
  await opener.click();
  await opener.pressSequentially("I keep putting off the things that matter to me.", { delay: 8 });
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByRole("button", { name: /structural & clear/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.getByRole("button", { name: /something i keep avoiding/i }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();

  const signIn = page.getByRole("button", { name: /sign in to keep this/i });
  await expect(signIn).toBeVisible({ timeout: 90_000 });
  await signIn.click();
  await page.waitForTimeout(6000); // Privy modal loads (third-party)
  await page.screenshot(shot("privy-modal"));

  const emailInputs = await page.getByPlaceholder(/email/i).count();
  const walletMentions = await page.getByText(/wallet/i).count();
  const googleBtn = await page.getByText(/google|continue with/i).count();
  console.log(`PRIVY_MODAL email=${emailInputs} wallet=${walletMentions} social=${googleBtn}`);
  // The integration works if the modal rendered *something* interactive.
  expect(emailInputs + walletMentions + googleBtn).toBeGreaterThan(0);
});
