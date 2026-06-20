import { test, expect } from "@playwright/test";

const LOCAL = /localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL ?? "");

// A demo guest can't write — /chat and /journal are auth-gated (requireUserId). The UI must show the
// honest sign-in line WITHOUT firing a doomed request that 401s into the console: the route prefetches
// whoami and, when the demo is gated, answers directly. These assert the request is never made.
//
// Local-only: needs a gated demo build carrying the fix (the live deploy lags), with the default
// KNOLE_REQUIRE_AUTH on so whoami reports { isDemo: true, gated: true }.
test.describe("guest write-gate is clean (no doomed fetch)", () => {
  test.skip(!LOCAL, "gated-demo guest behavior — runs against a local gated build with the fix");

  test("chat as guest: sign-in line, /chat/stream never called", async ({ page }) => {
    let hitStream = false;
    page.on("request", (r) => {
      if (r.url().includes("/chat/stream")) hitStream = true;
    });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    // Wait for the demo banner (the Shell's whoami resolved), then a buffer for the route's own whoami.
    await expect(page.getByText(/exploring the demo/i)).toBeVisible();
    await page.waitForTimeout(700);
    await page.getByPlaceholder(/say the small true thing/i).fill("What's been on my mind lately?");
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(page.getByText(/sign in to chat/i)).toBeVisible();
    expect(hitStream).toBe(false);
  });

  test("journal as guest: sign-in line, /journal/stream never called", async ({ page }) => {
    let hitStream = false;
    page.on("request", (r) => {
      if (r.url().includes("/journal/stream")) hitStream = true;
    });
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/exploring the demo/i)).toBeVisible();
    await page.waitForTimeout(700);
    await page.getByPlaceholder(/write what's true/i).fill("I have been feeling overwhelmed by work lately.");
    await page.getByRole("button", { name: /^reflect$/i }).click();
    await expect(page.getByText(/sign in to start your own knole/i)).toBeVisible();
    expect(hitStream).toBe(false);
  });
});
