#!/usr/bin/env node
// Capture the full Knole flow for public/proof-deck.html — the visual walkthrough a time-pressed judge
// or investor sees instead of running the app. Stills of every surface + a recorded video of the magic
// moment (write → reflection streaming) that the wrapper converts to a GIF. Reads the live deploy only;
// the write flow uses the guest onboarding path, which is ephemeral (no demo data is mutated).
// Run: node scripts/capture-proof-shots.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.PROOF_BASE_URL ?? "https://knole-app.vercel.app";
const OUT = "public/proof-shots";
mkdirSync(`${OUT}/vid`, { recursive: true });

const browser = await chromium.launch();

// ── The magic moment: a guest writes, the reflection streams in. Recorded for a GIF, plus two stills. ──
const ctx = await browser.newContext({
  viewport: { width: 1120, height: 760 },
  recordVideo: { dir: `${OUT}/vid`, size: { width: 1120, height: 760 } },
});
const rp = await ctx.newPage();
await rp.goto(`${BASE}/onboarding`, { waitUntil: "domcontentloaded" });
await rp.waitForTimeout(1300);
const ta = rp.getByPlaceholder(/something small or something heavy/i);
await ta.click();
await ta.pressSequentially(
  "I keep saying I'll start writing again, but every evening I find a reason not to.",
  { delay: 24 },
);
await rp.waitForTimeout(700);
await rp.screenshot({ path: `${OUT}/write.png` });
await rp.getByRole("button", { name: /^continue$/i }).click();
await rp.waitForTimeout(700);
await rp.getByRole("button", { name: /^continue$/i }).click(); // keep the default voice
await rp.waitForTimeout(700);
await rp.getByRole("button", { name: /something i keep avoiding/i }).click();
await rp.waitForTimeout(400);
await rp.getByRole("button", { name: /^continue$/i }).click(); // begin → the reflection streams
await rp.waitForTimeout(9000);
await rp.screenshot({ path: `${OUT}/reflection.png` });
await ctx.close(); // finalizes the .webm
console.log("captured the magic moment (write, reflection, video)");

// ── The rest of the journey, as retina stills. ──
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
async function shot(name, path, action) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  if (action) await action();
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("captured", name);
}

await shot("landing", "/");
await shot("today", "/today");
await shot("chat", "/chat");
await shot("memory-index", "/the-index");
await shot("remembered", "/remembered");
await shot("mirror", "/insights");
await shot("recover", "/settings", async () => {
  await page.getByRole("button", { name: /verify recoverable/i }).click();
  await page.getByText(/recovered live from 0g/i).waitFor({ timeout: 40_000 });
  await page.waitForTimeout(800);
  await page.getByText(/recovered live from 0g/i).scrollIntoViewIfNeeded();
});
await shot("ask-receipts", "/ask", async () => {
  const box = page.getByPlaceholder(/ask anything/i);
  await box.click();
  await box.pressSequentially("How do I usually talk about my mother?", { delay: 8 });
  await box.press("Enter");
  await page
    .getByText(/receipts|throughline/i)
    .first()
    .waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
});

await browser.close();
console.log("done — stills + video in", OUT);
