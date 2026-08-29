#!/usr/bin/env node
// Knole — Wave 3 demo recorder. Seven beats at true 4K against the live deploy, weighted to the
// wave's rubric (Progress 40 · 0G 30 · Technical 20 · Traction 10) rather than to a product tour.
// Storyboard and the reasoning behind the beat order: ./WAVE3.md
//
//   node scripts/demo-video/prepare-session.mjs    # seeds a real guest journal, saves its cookies
//   node scripts/demo-video/record-wave3.mjs       # → out/vid/<hash>.webm + out/spans-wave3.json
//   node scripts/demo-video/to-mp4.mjs             # → out/knole-wave3-4k.mp4 + 1080p
//
// Everything on camera is generated live during the take. The journal is seeded CONTENT (24 dated
// entries of prose); every memory, entity and relationship edge shown was produced from it by the
// ordinary pipeline.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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

const BASE = process.env.DEMO_BASE_URL ?? "https://knole.me";
const W = 3840,
  H = 2160;
const OUT = "scripts/demo-video/out";
const STATE = process.env.DEMO_STATE ?? `${OUT}/demo-session.json`;
mkdirSync(`${OUT}/vid`, { recursive: true });
const log = (m) => console.log(`· ${m}`);

if (!existsSync(STATE)) {
  console.error(
    `No seeded session at ${STATE}. Run prepare-session.mjs first — recording against an`,
  );
  console.error(`empty guest journal would film empty states, not the product.`);
  process.exit(1);
}

// Beat 5 films the REAL `forge test` output, typeset. Generated from out/forge-test.txt so the
// numbers can never drift from the suite — regenerate that file with:
//   forge test --summary > out/forge-test.txt
function terminalPage() {
  const raw = readFileSync(`${OUT}/forge-test.txt`, "utf8");
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = esc(raw)
    .replace(/^(\$ .*)$/gm, '<span class="cmd">$1</span>')
    .replace(/\b(\d+ tests? passed)\b/g, '<span class="ok">$1</span>')
    .replace(/\b(0 failed)\b/g, '<span class="ok">$1</span>');
  const html = `<!doctype html><meta charset="utf-8"><style>
    :root{color-scheme:dark}
    html,body{margin:0;height:100%;background:#12100e;}
    body{display:grid;place-items:center;font-family:"JetBrains Mono",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace}
    .win{width:1180px;background:#191612;border:1px solid #2e2823;border-radius:14px;overflow:hidden;
         box-shadow:0 40px 120px rgba(0,0,0,.6)}
    .bar{height:38px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#211d18;border-bottom:1px solid #2e2823}
    .dot{width:11px;height:11px;border-radius:50%}
    .t{margin-left:12px;color:#8b8078;font-size:12px;letter-spacing:.04em}
    pre{margin:0;padding:26px 28px 30px;color:#d9cfc4;font-size:15px;line-height:1.5;white-space:pre}
    .cmd{color:#e8dcc8}.ok{color:#7fbf7f}
  </style><div class="win">
    <div class="bar"><span class="dot" style="background:#e06c60"></span>
      <span class="dot" style="background:#e0b45c"></span>
      <span class="dot" style="background:#79c07a"></span>
      <span class="t">knole-app / contracts</span></div>
    <pre>${body}</pre></div>`;
  const file = path.resolve(`${OUT}/forge-test.html`);
  writeFileSync(file, html);
  return pathToFileURL(file).href;
}
const TERMINAL = terminalPage();

async function scrollElTo(page, locator, frac = 0.3, durMs = 2600) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  const delta = box.y / ZOOM - (H / ZOOM) * frac;
  if (Math.abs(delta) > 8) await smoothScroll(page, delta, durMs);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  storageState: STATE,
  recordVideo: { dir: `${OUT}/vid`, size: { width: W, height: H } },
});
await ctx.addInitScript(OVERLAY_INIT);
const page = await ctx.newPage();
const cap = (t) => caption(page, t);

// Dead LLM spans get timestamped so to-mp4 can ramp them 4× — a real wait, shown honestly, just not
// in real time.
const T0 = Date.now();
const spans = [];
const markStart = (l) => ({ l, s: (Date.now() - T0) / 1000 });
const markEnd = (m) => {
  m.e = (Date.now() - T0) / 1000;
  spans.push(m);
  log(`  dead-span ${m.l}: ${m.s.toFixed(1)}–${m.e.toFixed(1)}s`);
};

try {
  // ── BEAT 0 · cold open ────────────────────────────────────────────────────
  log("beat 0 — landing");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await applyZoom(page);
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
  await sleep(1600);
  await fadeOutCover(page);
  await sleep(600);
  await cap("A journal that remembers your life — and can prove it never read it in the clear.");
  await sleep(2700);
  await cap("");
  await parkCursor(page);
  await sleep(400);

  // ── BEAT 1 · it writes back, sealed in a 0G TEE ───────────────────────────
  log("beat 1 — write → sealed reflection");
  await gotoBeat(page, `${BASE}/today`);
  await cap("You write one honest line.");
  const ta = page.locator("textarea").first();
  await ta.scrollIntoViewIfNeeded().catch(() => {});
  await naturalType(
    page,
    ta,
    "Mara starts at Corvid on Monday and the flat is still full of boxes. I keep telling people I'm fine with the move.",
    { perCharMs: 26 },
  );
  await sleep(900);

  // Echoes: as the draft is typed, its embedding pulls up dated past entries. It appears BETWEEN
  // the textarea and the controls, so it shifts the Reflect button down after it has been measured
  // — the first take clicked where the button used to be and hit the header nav instead. Wait for
  // the panel to settle, show it (it is one of the better things the product does), and re-locate
  // the control immediately before clicking it.
  const echoes = page.getByText(/Echoes from your past/i).first();
  await echoes.waitFor({ timeout: 30_000 }).catch(() => {});
  await sleep(1200);
  await cap("While you write, it surfaces what you already said — dated.");
  await sleep(3000);
  await cap("");
  await sleep(400);

  // The lens row picks the voice; a separate Reflect button submits.
  const lens = page.locator('button:visible:has-text("Gentle")').first();
  await lens.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(500);
  await naturalClick(page, lens).catch(() => {});
  await sleep(700);
  // .last(): the header nav also carries a "Reflect" item; the composer's submit is the later one.
  const submit = page
    .locator("button:visible")
    .filter({ hasText: /^Reflect$/ })
    .last();
  await submit.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(800); // let the scroll settle so the click lands on the button, not where it was
  await naturalClick(page, submit).catch(() => {});
  const m1 = markStart("reflection");
  // The receipt link only appears once the reflection has finished and been committed. If it never
  // arrives the take is unusable, so say so loudly rather than filming a silent dead wait.
  const receiptLink = page.getByRole("button", { name: /reflection receipt/i }).first();
  let reflected = true;
  await receiptLink.waitFor({ timeout: 180_000 }).catch(() => {
    reflected = false;
  });
  if (!reflected) log("  !! the reflection never completed — this take is not usable");
  await sleep(1800);
  markEnd(m1);
  await cap("It writes back — in your voice, from your own past.");
  await sleep(2700);
  await cap("");
  // Open the receipt: the leaf hash, the enclave, and the on-chain anchor for THIS reflection.
  await scrollElTo(page, receiptLink, 0.55, 1800).catch(() => {});
  await naturalClick(page, receiptLink).catch(() => {});
  await sleep(2000);
  await cap("Composed inside a 0G TEE, attestation-verified — with a receipt for this reflection.");
  await sleep(3200);
  await cap("Not a privacy policy. A hash you can check against the chain yourself.");
  await sleep(2700);
  await cap("");
  await sleep(400);

  // ── BEAT 2 · the flagship — it remembers how your life CHANGED ────────────
  log("beat 2 — people → person");
  await gotoBeat(page, `${BASE}/people`);
  await cap("Every journal can store what you wrote.");
  await sleep(2200);
  await cap("This one knows how the people in it changed.");
  await sleep(2400);
  const mara = page.locator('a:has-text("Mara")').first();
  await naturalClick(page, mara).catch(() => page.goto(`${BASE}/person/Mara`));
  await sleep(1800);
  await cap("");
  await sleep(600);
  const changed = page.getByText(/What changed/i).first();
  await scrollElTo(page, changed, 0.34, 2400).catch(() => {});
  await sleep(900);
  await cap("The job she held for six years — and the day the journal saw it end.");
  await sleep(3200);
  await cap("Nobody typed a field. The prose was the input.");
  await sleep(2700);
  await cap("");
  await smoothScroll(page, 520, 2600);
  await sleep(1800);

  // ── BEAT 3 · ask, with receipts ───────────────────────────────────────────
  log("beat 3 — ask");
  await gotoBeat(page, `${BASE}/ask`);
  await cap("Ask it anything about your own life.");
  await sleep(2400);
  await cap("");
  // A PRESET, not a typed question. The free tier allows three custom asks a day and unlimited
  // presets, so this is both the honest default experience and the one that cannot fail mid-take
  // because an earlier test used the allowance up.
  const preset = page.getByRole("button", { name: /shifted in me/i }).first();
  await scrollElTo(page, preset, 0.35, 2000).catch(() => {});
  await naturalClick(page, preset).catch(() => {});
  const m2 = markStart("ask");
  let answered = true;
  await page
    .getByText(/THE THROUGHLINE/i)
    .first()
    .waitFor({ timeout: 150_000 })
    .catch(() => {
      answered = false;
    });
  if (!answered) log("  !! the ask never answered — this take is not usable");
  await sleep(2500);
  markEnd(m2);
  await cap("Answered from dated entries — every claim numbered to the words it came from.");
  await sleep(3300);
  await smoothScroll(page, 420, 2400);
  await sleep(1800);
  await cap("Composed inside the enclave too. Nobody else can read the question or the answer.");
  await sleep(3100);
  await cap("");
  await sleep(500);

  // ── BEAT 4 · on-chain, for real ───────────────────────────────────────────
  log("beat 4 — auditable AI");
  await gotoBeat(page, `${BASE}/verify`);
  await cap("Every claim on this page is read from 0G mainnet as it loads.");
  await sleep(4000);
  await smoothScroll(page, 420, 2400);
  await sleep(2400);
  await cap(
    "A real ERC-7857 iNFT. The control interface id returns false — a registry, not a stub.",
  );
  await sleep(3200);
  await smoothScroll(page, 700, 2800);
  await sleep(1800);
  await cap("And the sensing model: dataset, hashes, on-chain commitment. Auditable end to end.");
  await sleep(3200);
  await cap("");
  await sleep(600);

  // ── BEAT 5 · the judge's own ask ──────────────────────────────────────────
  log("beat 5 — forge test");
  await gotoBeat(page, TERMINAL);
  await cap("Last wave the judge asked for dedicated Solidity tests.");
  await sleep(2600);
  await cap("112 — unit, fuzz and invariant. The official 0G reference has no fuzz tests at all.");
  await sleep(3300);
  await cap("");
  await sleep(600);

  // ── BEAT 6 · traction + close ─────────────────────────────────────────────
  log("beat 6 — stats → close");
  await gotoBeat(page, `${BASE}/stats`);
  await cap("Real usage, counted honestly — the on-chain numbers carry their own receipts.");
  await sleep(3100);
  await cap("");
  await sleep(500);
  await gotoBeat(page, `${BASE}/`);
  await sleep(1200);
  await cap("Knole. A private AI that actually understands you.");
  await sleep(4000);
  await cap("");
  await sleep(700);
  await fadeToInk(page);
  await sleep(600);
} finally {
  writeFileSync(`${OUT}/spans-wave3.json`, JSON.stringify(spans, null, 1));
  await ctx.close();
  await browser.close();
  log(`done — video in ${OUT}/vid, spans in ${OUT}/spans-wave3.json`);
}
