#!/usr/bin/env node
// Exhaustive per-page pass: visit every route on the live deploy, screenshot it (retina), and assert
// the page actually rendered its real content (not just HTTP 200). Writes shots to public/proof-shots/
// pages/ and a JSON report to public/proof-shots/pages/audit.json. Run: node scripts/pages-audit.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.PROOF_BASE_URL ?? "https://knole-app.vercel.app";
const OUT = "public/proof-shots/pages";
mkdirSync(OUT, { recursive: true });

// route → keywords, ANY of which present in the page text proves the real content rendered.
const ROUTES = [
  ["landing", "/", ["mirror", "knole", "your words"]],
  ["onboarding", "/onboarding", ["something small", "write", "begin"]],
  ["today", "/today", ["today", "reflect", "on your mind", "entry"]],
  ["chat", "/chat", ["knole", "message", "say", "type"]],
  ["the-index", "/the-index", ["index", "memory", "remembers", "know"]],
  ["insights", "/insights", ["mirror", "mood", "insight", "pattern", "week"]],
  ["wrapped", "/wrapped", ["wrapped", "year", "card", "share"]],
  ["year", "/year", ["year", "months", "review"]],
  ["on-this-day", "/on-this-day", ["on this day", "year ago", "back then", "nothing yet"]],
  ["future", "/future", ["future", "self", "year from now", "simulate"]],
  ["ask", "/ask", ["ask", "your life", "question"]],
  ["assistant", "/assistant", ["assistant", "ask knole", "anything", "private"]],
  ["research", "/research", ["research", "private", "search", "look into"]],
  ["therapy", "/therapy", ["therapy", "session", "prep", "talking point"]],
  ["programs", "/programs", ["program", "guided", "day", "start"]],
  ["intentions", "/intentions", ["intention", "goal", "commit", "evidence"]],
  ["history", "/history", ["history", "verify", "receipt", "reflection"]],
  ["verify", "/verify", ["auditable ai", "your phone reads", "verify a reflection", "provenance"]],
  ["identity", "/identity", ["identity", "portable", "grant", "permission", "memory"]],
  ["settings", "/settings", ["settings", "voice", "quiet hours", "frequency", "night"]],
  ["create", "/create", ["create", "credit", "top up", "0g", "pay"]],
  ["upgrade", "/upgrade", ["upgrade", "plan", "deep", "free"]],
  ["extension", "/extension", ["extension", "chrome", "capture", "install"]],
  ["remembered", "/remembered", ["remembered", "knole now knows", "memory", "nothing yet"]],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const report = [];

for (const [name, path, keywords] of ROUTES) {
  const row = { name, path, ok: false, contentOk: false, title: "", h1: "", found: "", note: "" };
  try {
    const resp = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    row.status = resp?.status() ?? 0;
    await page.waitForTimeout(2200);
    try {
      await page.waitForLoadState("networkidle", { timeout: 6000 });
    } catch {
      /* fine — some pages keep a connection open */
    }
    await page.screenshot({ path: `${OUT}/${name}.png` });
    row.title = (await page.title()).slice(0, 80);
    row.h1 = (await page.locator("h1,h2").first().textContent().catch(() => "") || "").trim().slice(0, 80);
    const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    const hit = keywords.find((k) => text.includes(k.toLowerCase()));
    row.found = hit || "";
    row.contentOk = !!hit;
    row.ok = (row.status >= 200 && row.status < 400) && text.length > 200;
    row.note = `${text.length} chars`;
  } catch (e) {
    row.note = String(e).split("\n")[0].slice(0, 100);
  }
  report.push(row);
  console.log(`${row.ok && row.contentOk ? "✓" : row.ok ? "~" : "✗"} ${name.padEnd(14)} status=${row.status ?? "-"} content=${row.contentOk ? "yes(" + row.found + ")" : "NO"} ${row.note}`, ...(row.ok ? [] : ["<<"]));
}

writeFileSync(`${OUT}/audit.json`, JSON.stringify(report, null, 2));
const okc = report.filter((r) => r.ok && r.contentOk).length;
console.log(`\n=== ${okc}/${report.length} pages rendered real content ===`);
await browser.close();
