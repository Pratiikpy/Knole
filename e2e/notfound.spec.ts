import { test, expect } from "@playwright/test";

const LOCAL = /localhost|127\.0\.0\.1/.test(process.env.E2E_BASE_URL ?? "");

// The 404 surface must match Knole's brand (a warm, literary not-found), not a default error page —
// it's a first-contact surface. Asserts the branded copy. Local-only for now: the live deploy still
// serves the previous generic 404 until the next deploy, after which this can run against it too.
test("404 renders the branded not-found page", async ({ page }) => {
  test.skip(!LOCAL, "branded 404 ships on the next deploy; the live demo still has the old one");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/this-route-does-not-exist", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/slipped your memory/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /back to knole/i })).toBeVisible();
  expect(errors).toEqual([]);
});
