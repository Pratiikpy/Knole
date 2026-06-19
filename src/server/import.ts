import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { embed } from "./embed";
import { extractMemories } from "./engine";

const { entries, imports } = schema;

/** Split pasted history into the user's own substantive passages. */
export function splitHistory(text: string): string[] {
  const cleaned = text.replace(/\r/g, "");

  // ChatGPT-style export: keep only the user's turns.
  const parts = cleaned.split(/^(You said:|ChatGPT said:|Assistant:|User:)\s*/im);
  const userTurns: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    if (/^(You said:|User:)/i.test(parts[i])) userTurns.push((parts[i + 1] ?? "").trim());
  }

  const chunks = userTurns.length ? userTurns : cleaned.split(/\n\s*\n/).map((s) => s.trim());
  return chunks.filter((s) => s.length >= 40).slice(0, 60);
}

/**
 * The "refugee wedge": import a user's existing AI/journal history so Knole starts
 * already knowing them — each passage becomes a saved entry + extracted memories.
 */
export async function importHistory(
  userId: string,
  text: string,
  source?: string,
): Promise<{ imported: number; memories: number }> {
  const chunks = splitHistory(text);

  const [imp] = await db
    .insert(imports)
    .values({ userId, sourcePlatform: source ?? "text", status: "processing" })
    .returning();

  let imported = 0;
  let memories = 0;
  for (const c of chunks) {
    const v = await embed(c);
    const [e] = await db
      .insert(entries)
      .values({ userId, text: c, type: "saved", embedding: v })
      .returning();
    const mems = await extractMemories(userId, e.id, c);
    memories += mems.length;
    imported++;
  }

  await db.update(imports).set({ status: "done" }).where(eq(imports.id, imp.id));
  return { imported, memories };
}
