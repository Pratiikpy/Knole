import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { embed } from "./embed";
import { retrieveEntries } from "./engine";
import { chatPrivate } from "./sealed";

const { intentions } = schema;

export const MAX_ACTIVE = 3;

export type Intention = {
  id: string;
  text: string;
  status: string;
  source: string;
  createdAt: string;
};

export type Movement = {
  direction: "toward" | "drifted" | "none";
  quote: string | null; // a verbatim line from the person's own entries — the evidence
  entryDate: string | null;
  note: string | null; // one gentle, non-punishing sentence
};

export async function listIntentions(userId: string): Promise<Intention[]> {
  const rows = await db
    .select({
      id: intentions.id,
      text: intentions.text,
      status: intentions.status,
      source: intentions.source,
      createdAt: intentions.createdAt,
    })
    .from(intentions)
    .where(eq(intentions.userId, userId))
    .orderBy(desc(intentions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    status: r.status,
    source: r.source,
    createdAt: String(r.createdAt),
  }));
}

async function activeCount(userId: string): Promise<number> {
  const [r] = (await db.execute(sql`
    SELECT count(*) AS c FROM intentions WHERE user_id = ${userId} AND status = 'active'
  `)) as unknown as Record<string, unknown>[];
  return Number(r?.c ?? 0);
}

export async function createIntention(
  userId: string,
  text: string,
  source: "user" | "suggested" = "user",
): Promise<{ ok: true; id: string } | { ok: false; reason: "too_many" | "empty" }> {
  const t = text.trim();
  if (!t) return { ok: false, reason: "empty" };
  if ((await activeCount(userId)) >= MAX_ACTIVE) return { ok: false, reason: "too_many" };
  const vec = await embed(t);
  const [row] = await db
    .insert(intentions)
    .values({ userId, text: t, source, embedding: vec })
    .returning({ id: intentions.id });
  return { ok: true, id: row.id };
}

export async function setIntentionStatus(
  userId: string,
  id: string,
  status: "active" | "achieved" | "released",
): Promise<{ ok: boolean; reason?: "too_many" }> {
  // Re-activating is bounded by the same cap.
  if (status === "active" && (await activeCount(userId)) >= MAX_ACTIVE) {
    const [cur] = await db
      .select({ status: intentions.status })
      .from(intentions)
      .where(and(eq(intentions.id, id), eq(intentions.userId, userId)));
    if (cur && cur.status !== "active") return { ok: false, reason: "too_many" };
  }
  await db
    .update(intentions)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(intentions.id, id), eq(intentions.userId, userId)));
  return { ok: true };
}

const SUGGEST_SYS = `You read a person's recent journal entries and name what they seem to be working toward — the changes they keep reaching for (what motivational interviewing calls "change talk").
Return a JSON array of AT MOST 3 short intentions, each phrased in the second person as something to move toward — e.g. "Be less reactive when you're tired", "Decide about the job", "Spend more real time with Mara".
Only include genuine, recurring intentions — not one-off wishes. Return [] if nothing clear. Output ONLY the JSON array.`;

/**
 * AI-proposed intention candidates from recent entries (Rosebud's pattern: extract goals from what
 * they actually write, don't make them enter goals blind). Gated on having enough history. Returns
 * candidates for the person to accept — never auto-saved.
 */
export async function suggestIntentions(userId: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT text FROM entries WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 15
  `)) as unknown as Record<string, unknown>[];
  if (rows.length < 5) return []; // not enough to ground an honest suggestion
  const corpus = rows
    .map((r) => `- ${String(r.text).slice(0, 400)}`)
    .reverse()
    .join("\n");
  const existing = await listIntentions(userId);
  const existingActive = existing.filter((i) => i.status === "active").map((i) => i.text);
  const r = await chatPrivate(
    [
      { role: "system", content: SUGGEST_SYS },
      {
        role: "user",
        content: `Recent entries:\n${corpus}\n\nIntentions they already hold (don't repeat these):\n${
          existingActive.length ? existingActive.join("\n") : "(none)"
        }`,
      },
    ],
    { temperature: 0.3, maxTokens: 1024 },
  );
  let items: string[] = [];
  try {
    const m = r.content.match(/\[[\s\S]*\]/);
    items = m ? (JSON.parse(m[0]) as string[]) : [];
  } catch {
    items = [];
  }
  return items
    .filter((s) => typeof s === "string" && s.trim().length > 3)
    .map((s) => s.trim())
    .slice(0, 3);
}

const MOVE_SYS = `You assess whether a person has moved TOWARD an intention, DRIFTED from it, or shown NO clear signal — using only their own journal entries. Be honest but never punishing; a lapse is information, not a failure.
You MUST ground your read in one short VERBATIM quote copied exactly from one of the entries (do not paraphrase, do not invent). If nothing in the entries speaks to the intention, return direction "none" with an empty quote.
Return ONLY JSON: {"direction":"toward|drifted|none","quote":"<exact words from an entry, or empty>","entryDate":"<the YYYY-MM-DD of that entry, or empty>","note":"<one warm, plain sentence — no advice>"}.`;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Measure movement toward an intention, WITH a verbatim quote as evidence (the differentiator: nobody
 * does evidence-quoted goal tracking). The quote is validated to actually appear in the person's own
 * entries — a hallucinated quote is dropped, protecting the accuracy the whole feature rests on.
 */
export async function measureMovement(userId: string, intentionText: string): Promise<Movement> {
  const vec = await embed(intentionText);
  const entries = await retrieveEntries(userId, vec, 8);
  if (!entries.length) return { direction: "none", quote: null, entryDate: null, note: null };

  const block = entries
    .map((e) => `[${e.createdAt.slice(0, 10)}] ${e.text.slice(0, 500)}`)
    .join("\n\n");
  const r = await chatPrivate(
    [
      { role: "system", content: MOVE_SYS },
      { role: "user", content: `Intention: ${intentionText}\n\nTheir entries:\n${block}` },
    ],
    { temperature: 0.2, maxTokens: 1024 },
  );

  let parsed: Partial<Movement> = {};
  try {
    const m = r.content.match(/\{[\s\S]*\}/);
    parsed = m ? (JSON.parse(m[0]) as Partial<Movement>) : {};
  } catch {
    parsed = {};
  }
  const dir =
    parsed.direction === "toward" || parsed.direction === "drifted" ? parsed.direction : "none";

  // Evidence integrity: the quote must genuinely appear in one of the retrieved entries.
  let quote: string | null = null;
  let entryDate: string | null = null;
  const claimed = typeof parsed.quote === "string" ? parsed.quote.trim() : "";
  if (claimed.length > 3) {
    const hit = entries.find((e) => norm(e.text).includes(norm(claimed)));
    if (hit) {
      quote = claimed;
      entryDate = hit.createdAt.slice(0, 10);
    }
  }
  // A "toward"/"drifted" read with no real quote can't be trusted — fall back to no signal.
  if (!quote && dir !== "none")
    return { direction: "none", quote: null, entryDate: null, note: null };
  return {
    direction: quote ? dir : "none",
    quote,
    entryDate,
    note: typeof parsed.note === "string" ? parsed.note.slice(0, 240) : null,
  };
}
