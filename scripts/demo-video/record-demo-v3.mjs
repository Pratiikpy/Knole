#!/usr/bin/env node
// Knole demo-video recorder v3 — the full current product at true 4K. Records against a LOCAL
// auth-off server (KNOLE_REQUIRE_AUTH=off → every visit is the seeded demo user), so the new,
// login-gated beats record for real: the Sealed-in-0G-TEE badge, the crisis-safety response, and
// the minted memory iNFT (pre-minted off-camera by `npm run seed:inft` so the card is live on screen).
// Same rig as v2: 4K, cursor motion, ink-dip transitions, fade captions, dead-LLM spans ramped 4x.
//   server:  KNOLE_REQUIRE_AUTH=off DEMO_PRIVY_ID=demo OG_SEALED_INFERENCE=on OG_SEALED_STREAMING=off npm run dev
//   run:     node scripts/demo-video/record-demo-v3.mjs   (then: node scripts/demo-video/to-mp4.mjs)
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

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const DECK =
  process.env.DEMO_DECK_URL ?? pathToFileURL(path.resolve("public/proof-deck.html")).href;
const W = 3840,
  H = 2160;
const OUT = "scripts/demo-video/out";
mkdirSync(`${OUT}/vid`, { recursive: true });
const log = (m) => console.log(`· ${m}`);

async function scrollElTo(page, locator, frac = 0.3, durMs = 2600) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  const delta = box.y / ZOOM - (H / ZOOM) * frac;
  if (Math.abs(delta) > 8) await smoothScroll(page, delta, durMs);
}

const browser = await chromium.launch();

// ── Pre-warm the slow server paths (route compile + LLM caches) so on-camera calls are instant ──
log("pre-warming insights / ask / future / chat …");
{
  const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const wp = await wctx.newPage();
  for (const [route, until] of [
    ["/insights", /The throughline|your own words/i],
    ["/ask", null],
    ["/future", /future|remembered|risk/i],
    ["/wrapped", null],
    ["/the-index", /Own your memory|Minted/i],
    ["/settings", null],
    ["/today", /write what's true|something small/i],
  ]) {
    await wp.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    if (until)
      await wp
        .getByText(until)
        .first()
        .waitFor({ timeout: 60_000 })
        .catch(() => {});
    await wp.waitForTimeout(800);
  }
  // warm the ask answer + crisis reply
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

const T0 = Date.now();
const spans = [];
const markStart = (l) => ({ l, s: (Date.now() - T0) / 1000 });
const markEnd = (m) => {
  m.e = (Date.now() - T0) / 1000;
  spans.push(m);
  log(`  dead-span ${m.l}: ${m.s.toFixed(1)}–${m.e.toFixed(1)}s`);
};
const beat = async (name, fn) => {
  log(name);
  try {
    await fn();
  } catch (e) {
    log(`  ⚠ ${name} failed: ${e.message}`);
    await cap("");
  }
};

try {
  // ── BEAT 1 · the hook ──
  await beat("beat 1 — landing hook", async () => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await applyZoom(page);
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
    await sleep(1800);
    await fadeOutCover(page);
    await sleep(700);
    await cap("Every AI journal reads your private writing on someone else's servers.");
    await sleep(3400);
    await cap("Knole is the one that physically can't.");
    await sleep(3200);
    await parkCursor(page);
    await cap("");
    await sleep(500);
  });

  // ── BEAT 2 · the magic — write → reflection (Today) ──
  await beat("beat 2 — write → reflection", async () => {
    await gotoBeat(page, `${BASE}/today`);
    await cap("You write one honest line.");
    const ta = page.getByPlaceholder(/write what's true|something small/i);
    await naturalType(
      page,
      ta,
      "I keep saying I'll call my mother back, and every evening I find a reason not to.",
    );
    await sleep(500);
    const w = markStart("today");
    await naturalClick(page, page.getByRole("button", { name: /^reflect$/i }));
    await cap("Knole reflects — in your words, grounded in your past. A mirror, not a chatbot.");
    await page
      .getByTestId("reflection")
      .waitFor({ timeout: 60_000 })
      .catch(() => {});
    await sleep(6500);
    markEnd(w);
    await sleep(2600);
    await parkCursor(page);
    await cap("");
  });

  // ── BEAT 3+4 · sealed inference badge + the Mirror reveal ──
  await beat("beat 3/4 — sealed + the Mirror", async () => {
    await gotoBeat(page, `${BASE}/insights`);
    await page
      .getByText(/The throughline|your own words/i)
      .waitFor({ timeout: 60_000 })
      .catch(() => {});
    const badge = page.getByText(/Sealed in 0G TEE/i).first();
    if (await badge.isVisible().catch(() => false)) {
      await scrollElTo(page, badge, 0.3, 2000);
      await cap("Every reflection is read inside a sealed enclave on 0G —");
      await sleep(2600);
      await cap("— so not even we can see what the model sees.");
      await sleep(2600);
    } else {
      await cap("Read inside a sealed enclave on 0G — even we can't see what the model sees.");
      await sleep(2800);
    }
    await cap("Fourteen days in, Knole shows you the pattern you couldn't see —");
    await scrollElTo(page, page.getByText(/The throughline/i).first(), 0.26, 2600);
    await sleep(2600);
    await cap("— and quotes the exact day you said it.");
    await scrollElTo(page, page.getByText(/your own words/i).first(), 0.24, 3000).catch(() => {});
    await sleep(3200);
    await scrollElTo(
      page,
      page.getByText(/contradiction|circling|Only you can read/i).first(),
      0.28,
      2800,
    ).catch(() => {});
    await sleep(2600);
    await parkCursor(page);
    await cap("");
  });

  // ── BEAT 5 · Ask my life ──
  await beat("beat 5 — ask my life", async () => {
    await gotoBeat(page, `${BASE}/ask`);
    await cap("Ask your own past — it answers only from your real entries, and quotes you back.");
    await naturalType(
      page,
      page.getByPlaceholder(/ask anything/i),
      "How do I usually talk about my mother?",
    );
    await sleep(400);
    await page.keyboard.press("Enter");
    const w = markStart("ask");
    await page
      .getByText(/receipts|throughline/i)
      .first()
      .waitFor({ timeout: 60_000 })
      .catch(() => {});
    markEnd(w);
    await sleep(1400);
    await scrollElTo(page, page.getByText(/your own words|anonymised/i).first(), 0.34, 2600).catch(
      () => {},
    );
    await sleep(3000);
    await parkCursor(page);
    await cap("");
  });

  // ── BEAT 6 · it grows with you — Future-Self + Wrapped ──
  await beat("beat 6 — future + wrapped", async () => {
    await gotoBeat(page, `${BASE}/future`);
    await cap("A letter from the person your own entries point toward.");
    await page
      .getByText(/future|remembered|risk|year/i)
      .first()
      .waitFor({ timeout: 40_000 })
      .catch(() => {});
    await sleep(3200);
    await smoothScroll(page, 320, 2400).catch(() => {});
    await sleep(2400);
    await gotoBeat(page, `${BASE}/wrapped`);
    await cap("And a private year in one card — the shape, never the words.");
    await sleep(3800);
    await parkCursor(page);
    await cap("");
  });

  // ── BEAT 7 · when it matters — crisis safety ──
  await beat("beat 7 — crisis safety", async () => {
    await gotoBeat(page, `${BASE}/chat`);
    await sleep(800);
    const box = page.getByPlaceholder(/say the small true|what's on your mind|type/i).first();
    await naturalType(
      page,
      box,
      "I don't want to be alive anymore and I've been thinking about ending it.",
    );
    await sleep(300);
    await page.keyboard.press("Enter");
    await cap("When the words turn heavy, it stops being a mirror —");
    await page
      .getByText(/988|741741|reach out|real person|call or text/i)
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {});
    await sleep(2200);
    await cap("— and points you to real help.");
    await scrollElTo(page, page.getByText(/988|741741|Emergency/i).first(), 0.4, 2000).catch(
      () => {},
    );
    await sleep(3200);
    await parkCursor(page);
    await cap("");
  });

  // ── BEAT 8+9 · yours, on the record — The Index + the minted iNFT ──
  await beat("beat 8/9 — index + iNFT", async () => {
    await gotoBeat(page, `${BASE}/the-index`);
    await cap("Everything it knows — in your words, editable, forgettable, stamped to 0G.");
    await sleep(2600);
    await smoothScroll(page, 340, 2400);
    const trace = page.getByRole("button", { name: /trace|source/i }).first();
    if (await trace.isVisible().catch(() => false)) {
      await naturalClick(page, trace);
      await sleep(2400);
    }
    await cap("Your memory isn't only yours to read. It's yours to hold.");
    await scrollElTo(page, page.getByText(/Own your memory/i).first(), 0.26, 2800).catch(() => {});
    await sleep(2600);
    await cap("Minted to your own wallet on 0G — encrypted, evolving, and never for sale.");
    await scrollElTo(page, page.getByText(/view on 0G explorer/i).first(), 0.4, 1800).catch(
      () => {},
    );
    await sleep(3200);
    await parkCursor(page);
    await cap("");
  });

  // ── BEAT 10 · the thesis, proven live — recover from chain ──
  await beat("beat 10 — recover from chain", async () => {
    await gotoBeat(page, `${BASE}/settings`);
    await cap("Your words are encrypted under your key on 0G.");
    const recover = page.getByRole("button", { name: /verify recoverable/i });
    await recover.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(1400);
    await cap("Wipe the database — and your entry rebuilds, live, from chain.");
    await naturalClick(page, recover).catch(() => {});
    const w = markStart("recover");
    await page
      .getByText(/recovered live from 0g/i)
      .waitFor({ timeout: 30_000 })
      .catch(() => {});
    markEnd(w);
    await sleep(900);
    await scrollElTo(page, page.getByText(/recovered live from 0g/i).first(), 0.42, 1500).catch(
      () => {},
    );
    await sleep(3000);
    await parkCursor(page);
    await cap("");
  });

  // ── BEAT 11 · it's all real — the proof deck ──
  await beat("beat 11 — proof deck", async () => {
    await gotoBeat(page, DECK);
    await cap(
      "And it's all verified — 21 evals, sealed inference, an on-chain mint, a full run end to end.",
    );
    await smoothScroll(page, 1500, 2800);
    await sleep(500);
    await smoothScroll(page, 2100, 3000);
    await sleep(700);
    await cap("");
  });

  // ── BEAT 12 · close ──
  await beat("beat 12 — close", async () => {
    await gotoBeat(page, `${BASE}/`);
    await cap("Knole. A mirror, not an assistant.");
    await sleep(2900);
    await cap("Your words. Your key. Minted to you. Nobody else can read it.");
    await sleep(3200);
    await cap("");
    await sleep(200);
    await fadeToInk(page);
    await sleep(400);
  });
} finally {
  writeFileSync(`${OUT}/spans.json`, JSON.stringify(spans, null, 2));
  await ctx.close();
  await browser.close();
}
console.log("done — 4K webm in", `${OUT}/vid`, "· dead-spans:", spans.map((s) => s.l).join(","));
