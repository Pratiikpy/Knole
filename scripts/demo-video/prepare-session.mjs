#!/usr/bin/env node
// Put the recording browser inside a real, richly-seeded journal — WITHOUT forging a session cookie.
//
// Every visitor to Knole gets their own private guest journal, minted into a sealed cookie on first
// use. There is no shared demo account to fall back to any more, so a recorder that just opens the
// site films an empty product. Rather than hand-sealing a cookie (which means holding SESSION_SECRET
// in a script), this lets a REAL browser create its own guest the ordinary way, identifies which
// user that browser got by writing a one-off marker entry, seeds that user through the ordinary
// pipeline, and saves the browser's storage state for the recorder to reuse.
//
// The marker never survives: seed() resets the user before writing the arc.
//
//   node scripts/demo-video/prepare-session.mjs   → out/demo-session.json
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.DEMO_BASE_URL ?? "https://knole.me";
const OUT = "scripts/demo-video/out";
const STATE = path.join(OUT, "demo-session.json");
const MARKER = `knole-recorder-marker-${Date.now()}`;
mkdirSync(OUT, { recursive: true });
const log = (m) => console.log(`· ${m}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

log(`opening ${BASE} as a fresh visitor…`);
await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// One marker entry, written the way the app writes them, so the guest user actually exists and is
// identifiable. skipReflection keeps it cheap — we only need the row.
log("claiming this browser's guest journal…");
const status = await page.evaluate(async (marker) => {
  const r = await fetch("/journal/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entry: marker, lens: "gentle" }),
  });
  await r.text();
  return r.status;
}, MARKER);
if (status !== 200) {
  console.error(`marker write failed (${status}) — cannot identify the guest user`);
  process.exit(1);
}

await ctx.storageState({ path: STATE });
await browser.close();
log(`session saved → ${STATE}`);

// Find the user that marker landed on, then seed it through the real pipeline.
const { db } = await import("../../src/db/index.ts");
const { sql } = await import("drizzle-orm");
const rows = await db.execute(
  sql`SELECT user_id FROM entries WHERE text = ${MARKER} ORDER BY created_at DESC LIMIT 1`,
);
if (!rows.length) {
  console.error("marker entry not found in the database — aborting rather than seeding a guess");
  process.exit(1);
}
const userId = String(rows[0].user_id);
log(`guest user is ${userId.slice(0, 8)}… — seeding the arc (this takes a while)`);

const { seed } = await import("../../src/server/seed.ts");
const r = await seed(userId);
log(`seeded ${r.entries} entries, ${r.onChain} anchored on 0G`);

const edges = await db.execute(
  sql`SELECT source_name, relation, target_name, valid_at, invalid_at
      FROM memory_entity_edges WHERE user_id = ${userId}
      ORDER BY source_name, valid_at`,
);
console.log(`\nrelationship edges (${edges.length}):`);
for (const e of edges) {
  const when = e.invalid_at
    ? `${String(e.valid_at).slice(0, 10)} → ENDED ${String(e.invalid_at).slice(0, 10)}`
    : `since ${String(e.valid_at).slice(0, 10)}`;
  console.log(`  ${e.source_name} -${e.relation}-> ${e.target_name}  (${when})`);
}
console.log(`\nrecord with:  DEMO_STATE=${STATE} node scripts/demo-video/record-wave3.mjs`);
process.exit(0);
