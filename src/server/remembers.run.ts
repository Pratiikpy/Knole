import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry, extractMemories, retrieveMemories } from "./engine";
import { embed } from "./embed";
import { reflect } from "./reflect";

// The magical-first-5 north star, end-to-end: "next session it remembers." Journal entry A,
// let the engine extract a memory, then journal a related entry B and confirm the memory from
// A is recalled for B and a reflection comes back. The unit evals prove extract/retrieve/
// reflect in isolation; this proves they COMPOSE into the actual magic. Uses a throwaway user
// (created + deleted) so the demo stays pristine. On-demand: `npm run test:remembers`.

const { users, entries, memories, memoryHistory } = schema;

let [u] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.privyId, "remembers-test"))
  .limit(1);
if (!u)
  [u] = await db
    .insert(users)
    .values({ privyId: "remembers-test", email: "remembers@knole.local" })
    .returning({ id: users.id });
const uid = u.id;
const wipe = async () => {
  await db.delete(memoryHistory).where(eq(memoryHistory.userId, uid));
  await db.delete(memories).where(eq(memories.userId, uid));
  await db.delete(entries).where(eq(entries.userId, uid));
};
await wipe();

// 1. Journal entry A → the engine should extract a durable memory.
const A =
  "I finally quit my finance job to write a novel full-time. Terrifying and freeing at once.";
const entryA = await saveEntry(uid, A);
const extracted = await extractMemories(uid, entryA.id, A);
const gotMemory = extracted.length > 0;

// 2. Journal a related entry B days later → A's memory should be recalled for it.
const B =
  "Day three of the writing life. I keep second-guessing whether leaving the steady paycheck was naive.";
const bVec = await embed(B);
const recalled = await retrieveMemories(uid, bVec, 5, "quit finance job to write a novel");
const recalledTheDecision = recalled.some((m) =>
  /financ|writ|quit|job|novel|paycheck/i.test(m.content),
);

// 3. Reflect on B with the recalled context → a real reflection comes back.
const reflection = await reflect(
  B,
  recalled.map((m) => ({ content: m.content, sourceQuote: m.sourceQuote })),
);
const reflectionGenerated = reflection.trim().length > 50;

await wipe();
await db.delete(users).where(eq(users.id, uid));

console.log(`A → memory extracted:    ${gotMemory} (${extracted.length})`);
if (recalled[0]) console.log(`   recalled for B:       "${recalled[0].content.slice(0, 60)}…"`);
console.log(`B → recalled A's memory: ${recalledTheDecision}`);
console.log(`B → reflection returned: ${reflectionGenerated} (${reflection.trim().length} chars)`);

const ok = gotMemory && recalledTheDecision && reflectionGenerated;
console.log(
  ok
    ? "✅ REMEMBERS — journal something, and later Knole recalls it on its own"
    : "❌ FAIL: the cross-entry recall did not compose",
);
process.exit(ok ? 0 : 1);
