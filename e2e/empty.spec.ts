import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const shot = (name: string) => ({ path: `qa-shots/empty-${name}.png`, fullPage: true });

// L1 — the brand-new user (zero data): every surface shows its empty state cleanly, console-clean,
// no crash. Plus a11y basics. Needs a FRESH empty-user dev server (DEMO_PRIVY_ID=e2e-empty-qa).
test.describe("empty / first-run experience", () => {
  test.skip(!LOCAL, "needs a fresh empty-user dev server");
  test.setTimeout(90_000);

  const ROUTES = [
    ["/today", "today"],
    ["/insights", "insights"],
    ["/the-index", "the-index"],
    ["/year", "year"],
    ["/wrapped", "wrapped"],
    ["/ask", "ask"],
    ["/future", "future"],
    ["/on-this-day", "on-this-day"],
  ] as const;

  for (const [route, name] of ROUTES) {
    test(`empty ${route} renders cleanly`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
      const resp = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(resp?.status(), `${route} status`).toBeLessThan(400);
      await page.waitForTimeout(2500);
      await expect(page.locator("body")).toContainText(/\S/);
      expect(errors, `${route} console errors:\n${errors.join("\n")}`).toEqual([]);
      await page.screenshot(shot(name));
    });
  }

  test("insights shows the honest empty state (no fabricated mirror)", async ({ page }) => {
    await page.goto("/insights", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await expect(page.locator("body")).toContainText(/needs a few more entries|write on today/i);
  });

  test("a11y basics: skip-link + main landmark present", async ({ page }) => {
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await expect(page.getByRole("link", { name: /skip to content/i })).toBeAttached();
    await expect(page.locator("#main, main, [role=main]").first()).toBeAttached();
  });
});
