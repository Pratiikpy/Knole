#!/usr/bin/env node
// Re-capture the Ask My Life answer (the original shot caught the loading state because its wait matched
// the page heading "...with receipts"). Waits for the answer's privacy footer, which only renders once the
// answer is complete. Read-only; no writes. Run: node scripts/capture-ask.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.PROOF_BASE_URL ?? "https://knole-app.vercel.app";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

await page.goto(`${BASE}/ask`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const box = page.getByPlaceholder(/ask anything/i);
await box.click();
await box.pressSequentially("How do I usually talk about my mother?", { delay: 8 });
await box.press("Enter");
// The footer ("Anonymised before the AI saw it…") renders only when loading is done and the full
// answer + receipts are on screen.
await page.getByText(/anonymised before the ai saw it/i).waitFor({ timeout: 90_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: "public/proof-shots/ask-receipts.png", fullPage: true });
await browser.close();
console.log("re-captured ask-receipts (full answer)");
