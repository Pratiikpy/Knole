import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { listMemories, getSettings } from "./engine";
import { buildMirror } from "./mirror";
import { ownershipSummary } from "./restore";
import { resurface } from "./resurface";
import { generateNudge } from "./proactivity";

// Regression guard for the freshly-signed-in (zero-data) experience: every read path
// must return graceful empty signals — never crash — so the screens render their
// empty states (the-index "no memories", insights "come back in a few days",
// remembered "nothing to bring back yet"). Hard to exercise via the browser pre-auth.

const { users, entries, memories } = schema;

let [u] = await db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.privyId, "empty-test"))
  .limit(1);
if (!u)
  [u] = await db
    .insert(users)
    .values({ privyId: "empty-test", email: "empty@knole.local" })
    .returning({ id: users.id });
const uid = u.id;
await db.delete(memories).where(eq(memories.userId, uid));
await db.delete(entries).where(eq(entries.userId, uid));

const r: Record<string, unknown> = {};
let crashed = "";
try {
  r.memories = (await listMemories(uid)).length;
  r.settings = !!(await getSettings(uid));
  const own = await ownershipSummary(uid);
  r.ownership = `${own.totalEntries}/${own.onChain}/${own.roots.length}`;
  r.mirrorReady = (await buildMirror(uid)).ready; // false with <2 entries → screen shows empty state
  r.resurfaceEntryNull = (await resurface(uid)).entry === null; // null → "nothing to bring back yet"
  r.nudgeReturned = (await generateNudge(uid, 12)) !== undefined;
} catch (e) {
  crashed = e instanceof Error ? e.message : String(e);
}
console.log("empty-user reads:", JSON.stringify(r));
if (crashed) console.log("CRASHED:", crashed);

await db.delete(memories).where(eq(memories.userId, uid));
await db.delete(entries).where(eq(entries.userId, uid));
await db.delete(users).where(eq(users.id, uid));

const ok =
  !crashed &&
  r.memories === 0 &&
  r.settings === true &&
  r.ownership === "0/0/0" &&
  r.mirrorReady === false &&
  r.resurfaceEntryNull === true &&
  r.nudgeReturned === true;
console.log(ok ? "✅ EMPTY-USER OK (no crashes; graceful empty signals everywhere)" : "❌ FAIL");
process.exit(ok ? 0 : 1);
