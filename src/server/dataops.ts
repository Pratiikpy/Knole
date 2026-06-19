import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "../db";

const { entries, memories, memoryHistory, reflectionArtifacts, imports } = schema;

/** Permanently forget all entries + memories created within a date range. */
export async function forgetRange(
  userId: string,
  fromISO: string,
  toISO: string,
): Promise<{ entries: number; memories: number }> {
  const from = new Date(fromISO);
  const to = new Date(toISO);

  const delMem = await db
    .delete(memories)
    .where(
      and(eq(memories.userId, userId), gte(memories.createdAt, from), lte(memories.createdAt, to)),
    )
    .returning({ id: memories.id });
  const delEnt = await db
    .delete(entries)
    .where(
      and(eq(entries.userId, userId), gte(entries.createdAt, from), lte(entries.createdAt, to)),
    )
    .returning({ id: entries.id }); // cascades replies
  await db
    .delete(memoryHistory)
    .where(
      and(
        eq(memoryHistory.userId, userId),
        gte(memoryHistory.createdAt, from),
        lte(memoryHistory.createdAt, to),
      ),
    );

  return { entries: delEnt.length, memories: delMem.length };
}

/** Erase everything for this user — no copies kept. */
export async function deleteAccount(
  userId: string,
): Promise<{ entries: number; memories: number }> {
  await db.delete(memoryHistory).where(eq(memoryHistory.userId, userId));
  await db.delete(reflectionArtifacts).where(eq(reflectionArtifacts.userId, userId));
  await db.delete(imports).where(eq(imports.userId, userId));
  const delMem = await db
    .delete(memories)
    .where(eq(memories.userId, userId))
    .returning({ id: memories.id });
  const delEnt = await db
    .delete(entries)
    .where(eq(entries.userId, userId))
    .returning({ id: entries.id });
  return { entries: delEnt.length, memories: delMem.length };
}
