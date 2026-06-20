import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { getDemoUserId } from "./engine";
import { restoreEntryFromChain } from "./restore";

// Proof of the ownership spine (BUILD_PLAN M1): the Postgres copy is only a cache —
// the canonical entry lives on 0G, encrypted under the user's key. We corrupt the
// Postgres copy of one on-chain entry, rebuild it purely from 0G, and assert it comes
// back byte-identical, then restore the original so the demo stays pristine.
// Needs live 0G testnet access + at least one entry with a kv_ref, so it's an on-demand
// integration check (not in the CI gate): run with `npm run test:restore`.

const { entries } = schema;
const uid = await getDemoUserId();

const rows = (await db.execute(sql`
  SELECT id, kv_ref, text FROM entries
  WHERE user_id = ${uid} AND kv_ref IS NOT NULL ORDER BY created_at DESC LIMIT 1
`)) as unknown as Record<string, unknown>[];

if (!rows[0]) {
  console.log("⊘ skip: no on-chain entries to restore (store an entry on 0G first).");
  process.exit(0);
}

const id = String(rows[0].id);
const kvRef = String(rows[0].kv_ref);
const original = String(rows[0].text);

// Simulate a wiped DB: corrupt the Postgres copy.
await db
  .update(entries)
  .set({ text: "[[CORRUPTED — simulating a wiped DB]]" })
  .where(eq(entries.id, id));

let restoredText: string | null = null;
let err: string | null = null;
try {
  restoredText = (await restoreEntryFromChain(uid, kvRef)).text;
} catch (e) {
  err = (e as Error).message;
}

// Always put the canonical text back — the demo must stay pristine even if 0G was down.
await db.update(entries).set({ text: original }).where(eq(entries.id, id));

const ok = restoredText === original && original.length > 0;
console.log(`root      ${kvRef.slice(0, 22)}…`);
console.log(`original  (${original.length}) "${original.slice(0, 52)}…"`);
console.log(
  restoredText
    ? `from 0G   (${restoredText.length}) "${restoredText.slice(0, 52)}…"`
    : `from 0G   FAILED — ${err}`,
);
console.log(
  ok
    ? "✅ restore-from-chain: 0G rebuilt the wiped entry identically"
    : "❌ FAIL: restore did not match the original",
);
process.exit(ok ? 0 : 1);
