import { test, expect, type Page } from "@playwright/test";
import { createMailbox, waitForOtp } from "./helpers/mailbox";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);

const snap = async (page: Page, n: string) => {
  try {
    await page.screenshot({ path: `qa-shots/wallet-${n}.png`, timeout: 8000 });
  } catch {
    /* best-effort */
  }
};

// L4 — the REAL Privy email login, completed headlessly via a real disposable inbox. Get the code
// from the actual email, enter it, land an authenticated session with an embedded wallet.
test("Privy email login via real inbox → authenticated session", async ({ page }) => {
  test.skip(!LOCAL, "real Privy — needs local auth-on dev server");
  test.setTimeout(260_000);

  const { address, token } = await createMailbox();
  console.log("INBOX", address);

  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page
    .locator("button:visible", { hasText: /^\s*sign in\s*$/i })
    .first()
    .click({ timeout: 15000 });
  await page.waitForTimeout(4500);

  const email = page.getByPlaceholder(/email/i).first();
  await email.click();
  await email.fill(address);
  await email.press("Enter");
  await page.waitForTimeout(3000);
  await snap(page, "otp-req");

  const otp = await waitForOtp(token, 80000);
  console.log("OTP", otp);

  const otpBoxes = page.locator(
    'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[maxlength="1"]',
  );
  const nBoxes = await otpBoxes.count();
  console.log("OTP_BOXES", nBoxes);
  if (nBoxes >= otp.length) {
    for (let i = 0; i < otp.length; i++) await otpBoxes.nth(i).fill(otp[i]);
  } else {
    await page.locator("input").first().focus();
    await page.keyboard.type(otp, { delay: 150 });
  }
  await page.waitForTimeout(11000);
  await snap(page, "authed");

  console.log("FINAL_URL", page.url());
  const guest = await page.getByText(/exploring as a guest/i).count();
  const signOut = await page.getByRole("button", { name: /sign out/i }).count();
  console.log("GUEST", guest, "SIGNOUT", signOut);
  expect(signOut, "authenticated (Sign out visible)").toBeGreaterThan(0);

  // Affirm age (SB243 banner) so writes + mint aren't gated.
  const age = page.getByText(/i'?m 18 or older/i).first();
  if (await age.isVisible().catch(() => false)) {
    await age.click();
    await page.waitForTimeout(1500);
    console.log("AGE_AFFIRMED");
  }

  // FLOW: client-side (wallet) encryption enroll — the embedded wallet signs to derive the AES key.
  await page.getByRole("button", { name: /turn on wallet encryption/i }).click();
  await expect(page.getByText(/●\s*Sealed|Seal pending entries/i).first()).toBeVisible({
    timeout: 45000,
  });
  await snap(page, "client-enc-on");
  console.log("CLIENT_ENC_ENROLLED");

  // Give the freshly-created user memory so the mint has something to snapshot.
  async function journal(text: string) {
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const box = page.getByPlaceholder(/write what's true/i);
    await box.click();
    await box.press("ControlOrMeta+a");
    await box.press("Delete");
    await box.pressSequentially(text, { delay: 4 });
    await page.getByRole("button", { name: /^reflect$/i }).click();
    await expect(page.getByTestId("reflection")).toBeVisible({ timeout: 120000 });
    await page.waitForTimeout(2000);
  }
  await journal(
    "I left the firm this spring to try writing — still terrified, still sure it was right.",
  );
  await journal("Ran a long way this morning; my head clears when my legs ache.");

  // FLOW: iNFT mint via the UI (embedded wallet is the owner).
  await page.goto("/the-index", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const mintBtn = page.getByRole("button", { name: /mint my memory inft/i });
  await expect(mintBtn).toBeVisible({ timeout: 15000 });
  await mintBtn.click();
  await expect(
    page.getByText(/Minted\.|token #|Update with your latest self/i).first(),
  ).toBeVisible({ timeout: 90000 });
  console.log("INFT_MINTED");
  await snap(page, "minted");
});
