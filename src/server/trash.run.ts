import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry, retrieveEntries } from "./engine";
import { embed } from "./embed";
import {
  listEntries,
  listTags,
  setEntryTags,
  renameTag,
  trashEntry,
  restoreEntry,
  listTrash,
  purgeExpiredTrash,
} from "./trash";

// Integration test for trash/undo + tags (#35). DB-only (no model): tag set/rename, soft-delete →
// trash → restore, exclusion from recall, and purge of the expired window. `npm run test:trash`.

const { users, entries } = schema;
const PRIVY_ID = "trash-test-user";

function fail(msg: string): never {
  console.log(`❌ FAIL: ${msg}`);
  process.exit(1);
}

await db.delete(users).where(eq(users.privyId, PRIVY_ID));
const [u] = await db
  .insert(users)
  .values({ privyId: PRIVY_ID, email: "trash-test@knole.local" })
  .returning({ id: users.id });
const userId = u.id;

try {
  const e1 = await saveEntry(
    userId,
    "A run by the river this morning cleared my head.",
    undefined,
    "journal",
  );
  const e2 = await saveEntry(
    userId,
    "Tense call with work about the deadline.",
    undefined,
    "journal",
  );

  // Tags: set + list + filter.
  await setEntryTags(userId, e1.id, ["Running", "  Running ", "health"]); // dedup + trim + lowercase
  await setEntryTags(userId, e2.id, ["work"]);
  const tags = await listTags(userId);
  const running = tags.find((t) => t.tag === "running");
  if (!running || running.count !== 1)
    fail(`tag 'running' should exist with count 1: ${JSON.stringify(tags)}`);
  const [e1row] = await db
    .select({ tags: entries.tags })
    .from(entries)
    .where(eq(entries.id, e1.id));
  if ((e1row.tags as string[]).length !== 2)
    fail(`tags not deduped/normalized: ${JSON.stringify(e1row.tags)}`);

  const filtered = await listEntries(userId, "running");
  if (filtered.length !== 1 || filtered[0].id !== e1.id)
    fail("tag filter didn't isolate the tagged entry");

  // Rename a tag across entries.
  const changed = await renameTag(userId, "running", "runs");
  if (changed !== 1) fail(`rename should touch 1 entry, touched ${changed}`);
  const afterRename = await listEntries(userId, "runs");
  if (afterRename.length !== 1) fail("renamed tag not applied");

  // Soft delete → trash, and gone from live lists + recall.
  const del = await trashEntry(userId, e2.id);
  if (!del) fail("trashEntry returned false");
  const live = await listEntries(userId);
  if (live.some((e) => e.id === e2.id)) fail("deleted entry still in live list");
  const inTrash = (await listTrash(userId)).some((e) => e.id === e2.id);
  if (!inTrash) fail("deleted entry not in trash");

  // Recall must skip trashed entries — search for the deadline entry's own words.
  const qVec = await embed("work deadline tense call");
  const recalled = await retrieveEntries(userId, qVec, 5);
  if (recalled.some((e) => e.id === e2.id))
    fail("trashed entry leaked into recall (retrieveEntries)");

  // Restore brings it back.
  const restored = await restoreEntry(userId, e2.id);
  if (!restored) fail("restore returned false");
  const liveAgain = await listEntries(userId);
  if (!liveAgain.some((e) => e.id === e2.id)) fail("restored entry not back in live list");

  // Purge: age a trashed entry past the window, then it's hard-deleted.
  await trashEntry(userId, e2.id);
  await db.execute(
    sql`UPDATE entries SET deleted_at = now() - interval '40 days' WHERE id = ${e2.id}`,
  );
  const purged = await purgeExpiredTrash();
  if (purged < 1) fail("expired trash was not purged");
  const [gone] = await db.select({ id: entries.id }).from(entries).where(eq(entries.id, e2.id));
  if (gone) fail("purged entry still exists in the table");

  console.log(`tags dedup    : ["runs"?] normalized+deduped ✓`);
  console.log(`tag filter    : isolates tagged entry ✓`);
  console.log(`rename tag    : running → runs (1 entry) ✓`);
  console.log(`trash+restore : ✓`);
  console.log(`recall skip   : trashed entry excluded from retrieveEntries ✓`);
  console.log(`purge expired : hard-deleted after 30d ✓`);
  console.log(
    "✅ TRASH+TAGS: soft-delete, restore, recall-exclusion, tag set/rename/filter, purge",
  );

  await db.delete(users).where(eq(users.id, userId));
  process.exit(0);
} catch (e) {
  console.error("trash test threw:", (e as Error).message);
  await db
    .delete(users)
    .where(eq(users.id, userId))
    .catch(() => {});
  process.exit(1);
}
