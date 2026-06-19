import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";

const { reflectionArtifacts } = schema;

const RESURFACE_SYS = `You are Knole, gently bringing back something the user wrote a while ago. In 1-2 short sentences, name what you notice underneath it and ask — softly — whether that question is still alive for them. Warm and specific, never preachy, never clinical. Plain text only, no quotes around it.`;

export type Resurfaced = {
  entry: { text: string; date: string } | null;
  note: string;
};

export async function resurface(userId: string): Promise<Resurfaced> {
  // The "past self" — the earliest thing they wrote.
  const rows = (await db.execute(sql`
    SELECT text, created_at FROM entries
    WHERE user_id = ${userId} AND type = 'journal'
    ORDER BY created_at ASC LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (!rows[0]) return { entry: null, note: "" };

  const text = String(rows[0].text);
  const date = String(rows[0].created_at);

  // The "past self" entry is stable, so reuse a recent note instead of re-asking the LLM each view.
  const cachedNote = await cachedResurface(userId, date);
  if (cachedNote) return { entry: { text, date }, note: cachedNote };

  const r = await chatPrivate(
    [
      { role: "system", content: RESURFACE_SYS },
      { role: "user", content: `Their past entry:\n"${text}"\n\nWrite the one short note.` },
    ],
    { temperature: 0.7, maxTokens: 120 },
  ).catch(() => null);
  // If the LLM is unavailable, still resurface the entry with a gentle default note.
  const note =
    r?.content.trim() || "Here's something you wrote a while ago. Sit with it for a moment.";
  // Cache only a real composed note (not the offline fallback), keyed by the entry's date.
  if (r?.content.trim()) {
    try {
      await db.insert(reflectionArtifacts).values({
        userId,
        type: "pattern",
        threadKey: "resurface",
        content: { note },
        sources: { entryDate: date },
      });
    } catch {
      /* best-effort cache */
    }
  }
  return { entry: { text, date }, note };
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
