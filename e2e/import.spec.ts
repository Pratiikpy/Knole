import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const shot = (name: string) => ({ path: `qa-shots/${name}.png`, fullPage: true });

// L1 — the import-as-onboarding headliner: "bring your history from another AI". Drives import mode,
// pastes a multi-passage history, and asserts Knole counts the passages (the client-side split). The
// actual save needs auth (covered in the manual wallet checklist).
test("onboarding import: paste history → passages counted", async ({ page }) => {
  test.skip(!LOCAL, "import UI — runs against a local build");
  await page.goto("/onboarding", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /bring it/i }).click();

  const history = [
    "I left my job in finance last spring to try writing full time. It still scares me.",
    "My therapist said I intellectualize my feelings instead of feeling them. She's right.",
    "I keep saying I want rest, but I think I just want to be left alone for a week.",
    "I'm proud of finally booking the cabin trip — three nights by the lake in October.",
  ].join("\n\n");

  const box = page.getByPlaceholder(/paste your history here/i);
  await box.click();
  await box.fill(history);
  await expect(page.getByText(/Knole found ~\d+ passages to read/i)).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("checkbox").first().check();
  await page.screenshot(shot("import"));
});
