import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { db, schema } from "../db";

const { entries } = schema;

export const TRASH_WINDOW_DAYS = 30;

export type EntryRow = {
  id: string;
  text: string;
  title: string | null;
  tags: string[];
  type: string;
  createdAt: string;
};

/** Live entries (not deleted), newest first, optionally filtered to a single tag. */
export async function listEntries(userId: string, tag?: string): Promise<EntryRow[]> {
  const rows = await db
    .select({
      id: entries.id,
      text: entries.text,
      title: entries.title,
      tags: entries.tags,
      type: entries.type,
      createdAt: entries.createdAt,
    })
    .from(entries)
    .where(and(eq(entries.userId, userId), isNull(entries.deletedAt)))
    .orderBy(desc(entries.createdAt))
    .limit(300);
  const mapped = rows.map((r) => ({
    id: r.id,
    text: r.text,
    title: r.title,
    tags: (r.tags as string[] | null) ?? [],
    type: r.type,
    createdAt: String(r.createdAt),
  }));
  return tag ? mapped.filter((e) => e.tags.includes(tag)) : mapped;
}

/** Distinct user-facing tags with counts (internal program: tags are hidden). */
export async function listTags(userId: string): Promise<{ tag: string; count: number }[]> {
  const rows = (await db.execute(sql`
    SELECT tag, count(*)::int AS c
    FROM entries, jsonb_array_elements_text(tags) AS tag
    WHERE user_id = ${userId} AND deleted_at IS NULL
    GROUP BY tag
    ORDER BY c DESC, tag ASC
  `)) as unknown as Record<string, unknown>[];
  return rows
    .map((r) => ({ tag: String(r.tag), count: Number(r.c) }))
    .filter((t) => !t.tag.startsWith("program:"));
}

/** Replace an entry's tags (deduped, trimmed, capped). */
export async function setEntryTags(userId: string, entryId: string, tags: string[]): Promise<void> {
  const clean = Array.from(
    new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 40)),
  ).slice(0, 12);
  await db
    .update(entries)
    .set({ tags: clean })
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId)));
}

/** Rename a tag across all of the person's entries (a top journaling-app request). */
export async function renameTag(userId: string, from: string, to: string): Promise<number> {
  const f = from.trim().toLowerCase();
  const t = to.trim().toLowerCase();
  if (!f || !t || f === t) return 0;
  const res = (await db.execute(sql`
    UPDATE entries
    SET tags = (
      SELECT jsonb_agg(DISTINCT CASE WHEN el = ${f} THEN ${t} ELSE el END)
      FROM jsonb_array_elements_text(tags) AS el
    )
    WHERE user_id = ${userId} AND tags ? ${f}
    RETURNING id
  `)) as unknown as Record<string, unknown>[];
  return res.length;
}

/** Soft-delete → moves the entry to trash (recoverable for 30 days). */
export async function trashEntry(userId: string, entryId: string): Promise<boolean> {
  const res = await db
    .update(entries)
    .set({ deletedAt: new Date() })
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId), isNull(entries.deletedAt)))
    .returning({ id: entries.id });
  return res.length > 0;
}

/** Restore an entry from trash (within the window). */
export async function restoreEntry(userId: string, entryId: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE entries SET deleted_at = NULL
    WHERE id = ${entryId} AND user_id = ${userId}
      AND deleted_at IS NOT NULL
      AND deleted_at > now() - interval '${sql.raw(String(TRASH_WINDOW_DAYS))} days'
    RETURNING id
  `);
  return (res as unknown as unknown[]).length > 0;
}

/** Entries currently in trash (deleted within the window), newest-deleted first. */
export async function listTrash(userId: string): Promise<(EntryRow & { deletedAt: string })[]> {
  const rows = (await db.execute(sql`
    SELECT id, text, title, tags, type, created_at, deleted_at
    FROM entries
    WHERE user_id = ${userId} AND deleted_at IS NOT NULL
      AND deleted_at > now() - interval '${sql.raw(String(TRASH_WINDOW_DAYS))} days'
    ORDER BY deleted_at DESC
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    text: String(r.text),
    title: r.title == null ? null : String(r.title),
    tags: (r.tags as string[] | null) ?? [],
    type: String(r.type),
    createdAt: String(r.created_at),
    deletedAt: String(r.deleted_at),
  }));
}

/** Permanently remove entries whose trash window has expired. Run from the worker. Returns the count. */
export async function purgeExpiredTrash(): Promise<number> {
  const res = await db.execute(sql`
    DELETE FROM entries
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - interval '${sql.raw(String(TRASH_WINDOW_DAYS))} days'
    RETURNING id
  `);
  return (res as unknown as unknown[]).length;
}
