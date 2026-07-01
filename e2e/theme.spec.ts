import { test, expect } from "@playwright/test";
import { captureConsole } from "./helpers/console";

// L1 — the Night theme. Toggling reaches dark, persists across a full reload (the no-flash script
// reads localStorage), and the SSR↔client divergence stays warning-free (regression guard for the
// hydration fix on <html>).
test("dark mode toggles, persists, and stays console-clean", async ({ page }) => {
  const { errors } = captureConsole(page);
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500); // ThemeToggle renders null until it knows the theme

  const html = page.locator("html");
  const night = page.getByRole("button", { name: /switch to night/i });
  const day = page.getByRole("button", { name: /switch to day/i });

  // Reach dark from whichever state we start in.
  if (await night.isVisible().catch(() => false)) {
    await night.click();
  } else {
    await day.click();
    await page.getByRole("button", { name: /switch to night/i }).click();
  }
  await expect(html).toHaveClass(/dark/);

  // Persists across a full reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await expect(html).toHaveClass(/dark/);

  expect(errors, `dark-mode console errors:\n${errors.join("\n")}`).toEqual([]);
});
