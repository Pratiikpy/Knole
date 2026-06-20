import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";

const { reflectionArtifacts } = schema;

const DREAM_SYS = `You are Knole, reflecting overnight on what the user has written recently. Surface exactly ONE fresh observation they probably haven't noticed themselves — a connection between two things, a quiet shift, a pattern just starting to form. 2-3 complete, grammatical sentences — second person, warm and specific, grounded only in what they actually wrote. Finish every sentence; never trail off or garble a phrase. No preamble, no question at the end, plain text only.`;

export type Dream = { observation: string; createdAt: string };

export async function runDreaming(userId: string): Promise<{ observation: string } | null> {
  const entryRows = (await db.execute(sql`
    SELECT text FROM entries WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 20
  `)) as unknown as Record<string, unknown>[];
  const memRows = (await db.execute(sql`
    SELECT content FROM memories
    WHERE user_id = ${userId} AND status IN ('active', 'pinned')
    ORDER BY created_at DESC LIMIT 20
  `)) as unknown as Record<string, unknown>[];

  // dedupe near-identical entries
  const seen = new Set<string>();
  const entries = entryRows
    .map((r) => String(r.text))
    .filter((t) => {
      const k = t.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  if (entries.length < 2) return null;

  // Idempotent: one dream per user per (UTC) day. A re-run — a cron retry, or a manual
  // trigger overlapping the nightly job — skips instead of writing a duplicate.
  const dreamedToday = (await db.execute(sql`
    SELECT 1 FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = 'dreaming'
      AND created_at >= date_trunc('day', now())
    LIMIT 1
  `)) as unknown as unknown[];
  if (dreamedToday[0]) return null;

  const memories = memRows.map((r) => String(r.content));
  const context = `RECENT ENTRIES:\n${entries
    .map((t, i) => `[${i + 1}] ${t}`)
    .join("\n")}\n\nREMEMBERED:\n${memories.map((m) => `- ${m}`).join("\n")}`;

  const r = await chatPrivate(
    [
      { role: "system", content: DREAM_SYS },
      { role: "user", content: context },
    ],
    { temperature: 0.65, maxTokens: 200 },
  );
  const observation = r.content.trim();
  if (!observation) return null;

  await db.insert(reflectionArtifacts).values({
    userId,
    type: "pattern",
    threadKey: "dreaming",
    content: { observation },
    sources: { entryCount: entries.length },
  });
  return { observation };
}

export async function latestDream(userId: string): Promise<Dream | null> {
  const rows = (await db.execute(sql`
    SELECT content, created_at FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = 'dreaming'
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (!rows[0]) return null;
  const content = rows[0].content as { observation?: string };
  return { observation: String(content?.observation ?? ""), createdAt: String(rows[0].created_at) };
}
