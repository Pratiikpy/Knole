import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";

const { reflectionArtifacts } = schema;

const RESURFACE_SYS = `You are Knole, gently bringing back something the user wrote a while ago. In 1-2 short sentences, name what you notice underneath it and ask — softly — whether that question is still alive for them. Warm and specific, never preachy, never clinical. Plain text only, no quotes around it.`;

export type Resurfaced = {
  entry: { text: string; date: string } | null;
  note: string;
};

async function earliestEntry(userId: string): Promise<{ text: string; date: string } | null> {
  const rows = (await db.execute(sql`
    SELECT text, created_at FROM entries
    WHERE user_id = ${userId} AND type = 'journal' AND deleted_at IS NULL
    ORDER BY created_at ASC LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (!rows[0]) return null;
  return { text: String(rows[0].text), date: String(rows[0].created_at) };
}

/**
 * Fast path for the route loader — NEVER calls the LLM, so it can't block SSR (a synchronous sealed
 * inference here was a 504 on first view). Returns the past entry plus a cached note if one is fresh;
 * otherwise `note: ""` and the client asks `resurfaceNote()` to compose one after render.
 */
export async function resurface(userId: string): Promise<Resurfaced> {
  const e = await earliestEntry(userId);
  if (!e) return { entry: null, note: "" };
  const cachedNote = await cachedResurface(userId, e.date);
  return { entry: e, note: cachedNote ?? "" };
}

/** Lazily compose + cache the resurfacing note (the slow LLM step), called client-side after render. */
export async function resurfaceNote(userId: string): Promise<{ note: string }> {
  const e = await earliestEntry(userId);
  if (!e) return { note: "" };
  const cachedNote = await cachedResurface(userId, e.date);
  if (cachedNote) return { note: cachedNote };

  const r = await chatPrivate(
    [
      { role: "system", content: RESURFACE_SYS },
      { role: "user", content: `Their past entry:\n"${e.text}"\n\nWrite the one short note.` },
    ],
    { temperature: 0.7, maxTokens: 1024 },
  ).catch(() => null);
  const note =
    r?.content.trim() || "Here's something you wrote a while ago. Sit with it for a moment.";
  if (r?.content.trim()) {
    try {
      await db.insert(reflectionArtifacts).values({
        userId,
        type: "pattern",
        threadKey: "resurface",
        content: { note },
        sources: { entryDate: e.date },
      });
    } catch {
      /* best-effort cache */
    }
  }
  return { note };
}

async function cachedResurface(userId: string, entryDate: string): Promise<string | null> {
  try {
    const rows = (await db.execute(sql`
      SELECT content, sources FROM reflection_artifacts
      WHERE user_id = ${userId} AND thread_key = 'resurface'
        AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 1
    `)) as unknown as Record<string, unknown>[];
    if (!rows[0]) return null;
    const src = rows[0].sources as { entryDate?: string } | null;
    if (src?.entryDate !== entryDate) return null;
    const c = rows[0].content as { note?: string };
    return c?.note ? String(c.note) : null;
  } catch {
    return null;
  }
}
