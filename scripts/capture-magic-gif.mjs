#!/usr/bin/env node
// Records just the magic moment — a guest writes one line, the reflection streams in — as a short clip
// the wrapper converts to a small GIF for the proof deck. Guest onboarding path, ephemeral, no writes.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.PROOF_BASE_URL ?? "https://knole-app.vercel.app";
const DIR = "public/proof-shots/vid";
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1040, height: 680 },
  recordVideo: { dir: DIR, size: { width: 1040, height: 680 } },
});
const p = await ctx.newPage();
await p.goto(`${BASE}/onboarding`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(900);
const ta = p.getByPlaceholder(/something small or something heavy/i);
await ta.click();
await ta.pressSequentially("I keep saying I'll start writing again, but I find a reason not to.", {
  delay: 20,
});
await p.waitForTimeout(450);
await p.getByRole("button", { name: /^continue$/i }).click();
await p.waitForTimeout(350);
await p.getByRole("button", { name: /^continue$/i }).click();
await p.waitForTimeout(350);
await p.getByRole("button", { name: /something i keep avoiding/i }).click();
await p.waitForTimeout(250);
await p.getByRole("button", { name: /^continue$/i }).click();
await p.waitForTimeout(6000); // the reflection streams in
await ctx.close();
await browser.close();
console.log("magic clip recorded");
