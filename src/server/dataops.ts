import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { leaveCouple } from "./duet";

const {
  users,
  entries,
  memories,
  memoryHistory,
  memoryFeedback,
  memoryEntities,
  reflectionArtifacts,
  imports,
  receipts,
  pushSubscriptions,
  entryComments,
  entrySignals,
  intentions,
  programEnrollments,
  nudgeSettings,
  automations,
  archetypeReveals,
  instrumentScores,
  coupleAnswers,
} = schema;

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

/**
 * Erase everything for this user — no copies kept.
 *
 * This used to leave a long tail behind and still claim "no copies kept": receipts, push
 * subscriptions, margin comments, entity rows, wellbeing scores, duet data, signals, replies,
 * intentions, programs, nudge settings, automations, archetype reveals — and, worst of all, the
 * users row itself, which carries the wallet, the persona bio and the EXTENSION TOKEN HASH, so a
 * "deleted" account's browser extension could still authenticate and write new entries.
 * Order matters: children before parents, then the account row last.
 */
export async function deleteAccount(
  userId: string,
): Promise<{ entries: number; memories: number }> {
  // Couples first: membership is what links two accounts, and leaving deletes the shared rows.
  await leaveCouple(userId).catch(() => {});

  await db.delete(memoryHistory).where(eq(memoryHistory.userId, userId));
  await db.delete(memoryFeedback).where(eq(memoryFeedback.userId, userId));
  await db.delete(memoryEntities).where(eq(memoryEntities.userId, userId));
  await db.delete(reflectionArtifacts).where(eq(reflectionArtifacts.userId, userId));
  await db.delete(imports).where(eq(imports.userId, userId));
  await db.delete(receipts).where(eq(receipts.userId, userId));
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  await db.delete(entryComments).where(eq(entryComments.userId, userId));
  await db.delete(entrySignals).where(eq(entrySignals.userId, userId));
  await db.delete(intentions).where(eq(intentions.userId, userId));
  await db.delete(programEnrollments).where(eq(programEnrollments.userId, userId));
  await db.delete(nudgeSettings).where(eq(nudgeSettings.userId, userId));
  await db.delete(automations).where(eq(automations.userId, userId));
  await db.delete(archetypeReveals).where(eq(archetypeReveals.userId, userId));
  await db.delete(instrumentScores).where(eq(instrumentScores.userId, userId));
  await db.delete(coupleAnswers).where(eq(coupleAnswers.userId, userId));

  const delMem = await db
    .delete(memories)
    .where(eq(memories.userId, userId))
    .returning({ id: memories.id });
  // Replies hang off entries; clear them before the entries they belong to.
  await db.execute(sql`
    DELETE FROM replies WHERE parent_entry_id IN (SELECT id FROM entries WHERE user_id = ${userId})
  `);
  const delEnt = await db
    .delete(entries)
    .where(eq(entries.userId, userId))
    .returning({ id: entries.id });

  // Finally the account itself — this is what revokes the extension token, the wallet link and
  // the persona. Without it, "delete my account" left a working credential behind.
  await db.delete(users).where(eq(users.id, userId));
  return { entries: delEnt.length, memories: delMem.length };
}
