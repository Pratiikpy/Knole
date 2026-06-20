import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { exportMindfile } from "./mindfile";

// Verify the Mindfile export — the product's core ownership promise ("walk away with all of it") —
// returns the user's real data as clean, round-trippable JSON, and that forgotten / superseded /
// rejected memories are never leaked into it. Run: DB_HTTP=1 npm run test:export
const top = (await db.execute(sql`
  SELECT user_id, count(*) c FROM entries GROUP BY user_id ORDER BY c DESC LIMIT 1
`)) as unknown as { user_id: string; c: number }[];
if (!top[0]) {
  console.error("no user with entries — seed first");
  process.exit(1);
}
const userId = top[0].user_id;

const mf = await exportMindfile(userId);
console.log(
  `entries=${mf.counts.entries} memories=${mf.counts.memories} onChain=${mf.counts.onChain}`,
);

const structureOk =
  mf.entries.length === mf.counts.entries &&
  mf.memories.length === mf.counts.memories &&
  mf.entries.every(
    (e) => typeof e.text === "string" && e.text.length > 0 && !!e.type && !!e.createdAt,
  ) &&
  mf.memories.every((m) => typeof m.content === "string" && m.content.length > 0);

const json = JSON.stringify(mf, null, 2);
const roundtrips = JSON.parse(json).counts.entries === mf.counts.entries;

// Forgotten / superseded / rejected memories must NOT appear in the export.
const hidden = (await db.execute(sql`
  SELECT content FROM memories
  WHERE user_id = ${userId} AND status IN ('forgotten', 'superseded', 'rejected')
`)) as unknown as { content: string }[];
const exported = new Set(mf.memories.map((m) => m.content));
const leaked = hidden.filter((h) => exported.has(h.content));

if (mf.counts.entries < 1) {
  console.error("❌ export returned no entries");
  process.exit(1);
}
if (!structureOk) {
  console.error("❌ export structure invalid");
  process.exit(1);
}
if (!roundtrips) {
  console.error("❌ export JSON does not round-trip");
  process.exit(1);
}
if (leaked.length) {
  console.error(`❌ ${leaked.length} forgotten/superseded memories leaked into the export`);
  process.exit(1);
}
console.log(`forgotten excluded: ${hidden.length} hidden in DB, 0 leaked`);
console.log("✅ MINDFILE EXPORT OK");
process.exit(0);
