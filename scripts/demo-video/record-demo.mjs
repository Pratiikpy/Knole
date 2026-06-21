#!/usr/bin/env node
// Knole demo-video recorder v2 — true 4K (3840x2160), 8 beats including the flagship Mirror and the
// Index, premium motion + ink-dip transitions + fade captions. Reads the live deploy only; the write
// is the ephemeral guest path; cookies are cleared after so the seeded demo carries the rest. The
// Mirror / Ask / recover caches are pre-warmed in a throwaway context so the on-camera calls are fast.
// Run: node scripts/demo-video/record-demo.mjs   (then: node scripts/demo-video/to-mp4.mjs)
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  OVERLAY_INIT,
  ZOOM,
  applyZoom,
  gotoBeat,
  fadeOutCover,
  fadeToInk,
  caption,
  naturalClick,
  naturalType,
  smoothScroll,
  parkCursor,
  sleep,
} from "./demo-lib.mjs";

const BASE = process.env.DEMO_BASE_URL ?? "https://knole-app.vercel.app";
const DECK =
  process.env.DEMO_DECK_URL ?? pathToFileURL(path.resolve("public/proof-deck.html")).href;
const W = 3840,
  H = 2160;
const OUT = "scripts/demo-video/out";
mkdirSync(`${OUT}/vid`, { recursive: true });
const log = (m) => console.log(`· ${m}`);

// smooth-scroll a located element to ~frac down the viewport (handles the zoom coordinate mix)
async function scrollElTo(page, locator, frac = 0.3, durMs = 2800) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  const delta = box.y / ZOOM - (H / ZOOM) * frac;
  if (Math.abs(delta) > 8) await smoothScroll(page, delta, durMs);
}

const browser = await chromium.launch();

// ── Pre-warm the slow LLM paths (server-side caches) so the on-camera calls are fast ──
log("pre-warming mirror / ask / recover…");
{
  const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const wp = await wctx.newPage();
  await wp.goto(`${BASE}/insights`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await wp
    .getByText(/The throughline/i)
    .waitFor({ timeout: 60_000 })
    .catch(() => {});
  await wp.goto(`${BASE}/ask`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await wp
    .getByPlaceholder(/ask anything/i)
    .fill("How do I usually talk about my mother?")
    .catch(() => {});
  await wp.keyboard.press("Enter").catch(() => {});
  await wp
    .getByText(/receipts|throughline/i)
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => {});
  await wp.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" }).catch(() => {});
  const wr = wp.getByRole("button", { name: /verify recoverable/i });
  await wr.scrollIntoViewIfNeeded().catch(() => {});
  await wr.click().catch(() => {});
  await wp
    .getByText(/recovered live from 0g/i)
    .waitFor({ timeout: 45_000 })
    .catch(() => {});
  await wctx.close();
  log("pre-warm done");
}

const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: `${OUT}/vid`, size: { width: W, height: H } },
});
await ctx.addInitScript(OVERLAY_INIT);
const page = await ctx.newPage();
const cap = (t) => caption(page, t);

// timestamp the dead LLM-loader spans (relative to record start) so to-mp4 can speed-ramp them 4x
const T0 = Date.now();
const spans = [];
const markStart = (l) => ({ l, s: (Date.now() - T0) / 1000 });
const markEnd = (m) => {
  m.e = (Date.now() - T0) / 1000;
  spans.push(m);
  log(`  dead-span ${m.l}: ${m.s.toFixed(1)}–${m.e.toFixed(1)}s`);
};

try {
  // ── BEAT 1 · the hook — the journal that writes back ──
  log("beat 1 — landing hook");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await applyZoom(page);
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
  await sleep(1800);
  await fadeOutCover(page); // paper-less open: ink lifts off the hero
  await sleep(700);
  await cap("Every AI journal reads your private writing on someone else's servers.");
  await sleep(3400);
  await cap("Knole is the one that physically can't.");
  await sleep(3200);
  await parkCursor(page);
  await cap("");
  await sleep(500);

  // ── BEAT 2 · the magic — one honest line, reflected ──
  log("beat 2 — write → reflection");
  await gotoBeat(page, `${BASE}/onboarding`);
  await cap("You write one honest line.");
  const ta = page.getByPlaceholder(/something small or something heavy/i);
  await naturalType(
    page,
    ta,
    "I keep saying I'll start writing again, but every evening I find a reason not to.",
  );
  await sleep(600);
  // onboarding runs an LLM call per step (~10s each) then streams the reflection. Capture the whole
  // live flow in ONE dead-span, ramped 4x in post — the magic stays, the waiting doesn't.
  const wOnb = markStart("onboard");
  await naturalClick(page, page.getByRole("button", { name: /^continue$/i }));
  await sleep(400);
  await naturalClick(page, page.getByRole("button", { name: /^continue$/i }));
  await sleep(400);
  await naturalClick(page, page.getByRole("button", { name: /something i keep avoiding/i }));
  await sleep(300);
  await cap("Knole reflects — in your words, grounded in your past. A mirror, not a chatbot.");
  await naturalClick(page, page.getByRole("button", { name: /^continue$/i }));
  await page
    .getByText(/the first reflection|then let's start there/i)
    .first()
    .waitFor({ timeout: 40_000 })
    .catch(() => {});
  await sleep(13000); // let the reflection stream fully (inside the ramped dead-span)
  markEnd(wOnb);
  await sleep(2600); // 1x hold on the finished reflection
  await parkCursor(page);
  await cap("");
  await ctx.clearCookies(); // guest write is ephemeral → seeded demo carries the rest

  // ── BEAT 3 · THE FLAGSHIP — the Pattern Mirror (day-15 reveal) ──
  log("beat 3 — the Mirror");
  await gotoBeat(page, `${BASE}/insights`);
  await page
    .getByText(/The throughline/i)
    .waitFor({ timeout: 60_000 })
    .catch(() => log("  (mirror: throughline not detected)"));
  await cap("Fourteen days in, Knole shows you the pattern you couldn't see —");
  await sleep(2600);
  await scrollElTo(page, page.getByText(/The throughline/i).first(), 0.26, 2600);
  await sleep(2800);
  await cap("— and quotes the exact day you said it.");
  await scrollElTo(page, page.getByText(/your own words/i).first(), 0.24, 3000);
  await sleep(3400); // hold on a pattern + its dated receipt (the hero frame)
  await scrollElTo(page, page.getByText(/The contradiction|circling/i).first(), 0.26, 2800).catch(
    () => {},
  );
  await sleep(2600);
  await scrollElTo(page, page.getByText(/Only you can read this/i).first(), 0.3, 2800).catch(
    () => {},
  );
  await sleep(2400);
  await cap("");

  // ── BEAT 4 · it remembers — ask your past, it quotes you back ──
  log("beat 4 — ask my life");
  await gotoBeat(page, `${BASE}/ask`);
  await cap("Ask your own past — it answers only from your real entries, and quotes you back.");
  await naturalType(
    page,
    page.getByPlaceholder(/ask anything/i),
    "How do I usually talk about my mother?",
  );
  await sleep(400);
  await page.keyboard.press("Enter");
  const wAsk = markStart("ask");
  await page
    .getByText(/receipts|throughline/i)
    .first()
    .waitFor({ timeout: 60_000 })
    .catch(() => log("  (ask: receipts not detected)"));
  markEnd(wAsk);
  await sleep(1400);
  await scrollElTo(page, page.getByText(/your own words|anonymised/i).first(), 0.34, 2600).catch(
    () => {},
  );
  await sleep(3200); // hold on the dated quotes + the 'anonymised before the AI' footer
  await parkCursor(page);
  await cap("");

  // ── BEAT 5 · yours, on the record — The Index + 0G ──
  log("beat 5 — the index");
  await gotoBeat(page, `${BASE}/the-index`);
  await cap("Everything it knows — in your words, editable, forgettable, stamped to 0G.");
  await sleep(2600);
  await smoothScroll(page, 360, 2600);
  const trace = page.getByRole("button", { name: /trace|source/i }).first();
  if (await trace.isVisible().catch(() => false)) {
    await naturalClick(page, trace);
    await sleep(2800); // the source panel + on-chain 0x ref fades up
  } else {
    await sleep(2200);
  }
  await cap("We can't read it, can't reset it, can't take it away.");
  await sleep(2600);
  await cap("");

  // ── BEAT 6 · THE THESIS, proven live — recover from chain ──
  log("beat 6 — recover from chain");
  await gotoBeat(page, `${BASE}/settings`);
  await cap("Your words are encrypted under your key on 0G.");
  const recover = page.getByRole("button", { name: /verify recoverable/i });
  await recover.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(1500);
  await cap("Wipe the database — and your entry rebuilds, live, from chain.");
  await naturalClick(page, recover).catch(() => {});
  const wRec = markStart("recover");
  await page
    .getByText(/recovered live from 0g/i)
    .waitFor({ timeout: 30_000 })
    .catch(() => log("  (recover: confirmation not detected)"));
  markEnd(wRec);
  await sleep(900);
  await scrollElTo(page, page.getByText(/recovered live from 0g/i).first(), 0.42, 1500).catch(
    () => {},
  );
  await sleep(3000); // the thesis frame — decrypted entry rebuilt from chain
  await parkCursor(page);
  await cap("");

  // ── BEAT 7 · it's real — the proof deck ──
  log("beat 7 — proof deck");
  await gotoBeat(page, DECK);
  await cap("And it's all verified — 21 evals, real on-chain roots, every claim provable.");
  await smoothScroll(page, 1500, 2800);
  await sleep(500);
  await smoothScroll(page, 1700, 2800);
  await sleep(700);
  await cap("");

  // ── BEAT 8 · close — the line ──
  log("beat 8 — close");
  await gotoBeat(page, `${BASE}/`);
  await cap("Knole. A mirror, not an assistant.");
  await sleep(2900);
  await cap("Your words. Your key. Nobody else can read it.");
  await sleep(3000);
  await cap("");
  await sleep(200);
  await fadeToInk(page); // ink fade-out close
  await sleep(400);
} finally {
  writeFileSync(`${OUT}/spans.json`, JSON.stringify(spans, null, 2));
  await ctx.close();
  await browser.close();
}
console.log("done — 4K webm in", `${OUT}/vid`, "· dead-spans:", spans.map((s) => s.l).join(","));
