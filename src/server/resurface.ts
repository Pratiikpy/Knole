import { sql } from "drizzle-orm";
import { db } from "../db";
import { chatPrivate } from "./sealed";

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
  const r = await chatPrivate(
    [
      { role: "system", content: RESURFACE_SYS },
      { role: "user", content: `Their past entry:\n"${text}"\n\nWrite the one short note.` },
    ],
    { temperature: 0.7, maxTokens: 120 },
  );
  return { entry: { text, date }, note: r.content };
}
