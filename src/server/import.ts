import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { embed } from "./embed";
import { extractMemories } from "./engine";
import { splitHistory } from "../lib/splitHistory";

// Re-exported for back-compat; the pure splitter now lives in lib so onboarding can import it
// client-side (for a live passage count) without pulling the server import pipeline into the bundle.
export { splitHistory };

const { entries, imports } = schema;

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
