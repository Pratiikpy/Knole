import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";
import { recordReceipt } from "./receipts";

const { reflectionArtifacts } = schema;

// The Overnight Self-Portrait (letta/MemGPT's core-memory block, made visible).
//
// Knole's self-model used to be stateless — re-derived from top-N memories on every call, with
// no text of its own and therefore nothing that could *change*. This gives it letta's one great
// property: a persistent portrait that is rewritten RELATIVE TO ITS OWN LAST VERSION, nightly,
// by the same worker that dreams. The morning after, the user sees the word-diff — "what Knole
// re-understood about you overnight" — which turns the memory engine from an invisible index
// into a living document the user can watch evolve, correct, and own.
//
// Discipline, in order of importance:
// - Grounded ONLY in entries + extracted memories; the portrait may not invent.
// - Rewritten relative to itself: continuity is the point. A brand-new text every night would
//   be a summary, not a portrait.
// - "No meaningful change" is a first-class outcome: the model says UNCHANGED, no row is
//   written, and the diff surface stays quiet. A portrait that mutates cosmetically every night
//   teaches the user to ignore it.
// - Supersede-not-delete: every prior portrait is kept (thread history), so the whole arc of
//   "who Knole thought you were" is replayable — and receipts anchor each rewrite.

const PORTRAIT_SYS = `You are Knole, maintaining a living portrait of who this person is becoming — a short text you yourself wrote last time, which you now revise in light of what they've written since.

You are given your CURRENT PORTRAIT and the NEW MATERIAL (recent entries, durable memories, last night's observation).

Rewrite the portrait:
- Keep what is still true, in your previous wording where it still fits — continuity matters.
- Revise what has shifted. Fold in what is genuinely new. Drop what has gone stale.
- Ground every sentence in what they actually wrote. Never invent, never flatter, never diagnose.
- 120-200 words. Second person ("You..."). Plain prose — no lists, no headers.
- Their contradictions belong in the portrait; a person is not a summary.
- Never assume anyone's gender: people they mention are their name, or "they".

If nothing has meaningfully changed since the current portrait, reply with exactly: UNCHANGED`;

export type SelfPortrait = {
  text: string;
  createdAt: string;
  previous: string | null; // the version this one replaced — the client diffs the two
};

/** The current portrait + the version before it (for the morning diff). */
export async function latestSelfPortrait(userId: string): Promise<SelfPortrait | null> {
  const rows = (await db.execute(sql`
    SELECT content, created_at FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = 'self_model'
    ORDER BY created_at DESC LIMIT 2
  `)) as unknown as { content: { text?: string }; created_at: unknown }[];
  if (!rows[0]?.content?.text) return null;
  return {
    text: String(rows[0].content.text),
    createdAt: new Date(String(rows[0].created_at)).toISOString(),
    previous: rows[1]?.content?.text ? String(rows[1].content.text) : null,
  };
}

/**
 * Nightly rewrite. Returns the new portrait when one was written, null when skipped (not enough
 * material, already ran today, model down, or genuinely UNCHANGED).
 */
export async function runSelfPortrait(userId: string): Promise<{ text: string } | null> {
  // Idempotent per UTC day, same rule as dreaming: a cron retry must not double-write.
  const ranToday = (await db.execute(sql`
    SELECT 1 FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = 'self_model'
      AND created_at >= date_trunc('day', now())
    LIMIT 1
  `)) as unknown as unknown[];
  if (ranToday[0]) return null;

  const current = await latestSelfPortrait(userId);

  // New material since the last portrait (or the recent window for a first portrait). The
  // portrait only reacts to what changed — feeding it the whole corpus every night would drown
  // continuity in noise.
  const sinceSql = current
    ? sql`AND created_at > ${current.createdAt}`
    : sql`AND created_at > now() - interval '30 days'`;
  const entryRows = (await db.execute(sql`
    SELECT text FROM entries
    WHERE user_id = ${userId} AND deleted_at IS NULL AND type = 'journal' ${sinceSql}
    ORDER BY created_at DESC LIMIT 12
  `)) as unknown as { text: string }[];
  const memRows = (await db.execute(sql`
    SELECT content, type FROM memories
    WHERE user_id = ${userId} AND status IN ('active', 'pinned') ${sinceSql}
    ORDER BY created_at DESC LIMIT 15
  `)) as unknown as { content: string; type: string }[];
  const dreamRows = (await db.execute(sql`
    SELECT content FROM reflection_artifacts
    WHERE user_id = ${userId} AND thread_key = 'dreaming' ${sinceSql}
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as { content: { observation?: string } }[];

  // First portrait needs real material; a rewrite needs SOMETHING new to react to.
  if (!current && entryRows.length < 3) return null;
  if (current && entryRows.length === 0 && memRows.length === 0) return null;

  const clip = (t: string) => (t.length > 320 ? t.slice(0, 320) + "…" : t);
  const material = [
    entryRows.length
      ? `NEW ENTRIES:\n${entryRows.map((r, i) => `[${i + 1}] ${clip(r.text)}`).join("\n")}`
      : "",
    memRows.length
      ? `NEW DURABLE MEMORIES:\n${memRows.map((m) => `- (${m.type}) ${clip(m.content)}`).join("\n")}`
      : "",
    dreamRows[0]?.content?.observation
      ? `LAST NIGHT'S OBSERVATION:\n${clip(String(dreamRows[0].content.observation))}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const r = await chatPrivate(
    [
      { role: "system", content: PORTRAIT_SYS },
      {
        role: "user",
        content: `CURRENT PORTRAIT:\n${current?.text ?? "(none yet — this is the first one; write it from the material alone)"}\n\nNEW MATERIAL:\n${material}`,
      },
    ],
    { temperature: 0.4, maxTokens: 1200 },
  );
  const text = r.content.trim();
  if (!text) return null;
  // UNCHANGED is a real outcome, not a failure: no row, no diff, no noise tomorrow morning.
  if (/^UNCHANGED\b/i.test(text.slice(0, 20))) return null;
  if (current && text === current.text) return null;
  // A portrait that ballooned or collapsed is a failed generation, not an update.
  const words = text.split(/\s+/).length;
  if (words < 60 || words > 300) return null;

  await db.insert(reflectionArtifacts).values({
    userId,
    type: "state",
    threadKey: "self_model",
    content: { text },
    sources: { entries: entryRows.length, memories: memRows.length },
  });
  // The portrait is derived, durable state about the user - it gets a receipt like a dream does,
  // with the honest per-response sealed flag.
  try {
    await recordReceipt(userId, { input: material.slice(0, 8000), output: text, sealed: r.sealed });
  } catch (e) {
    console.error("self-portrait receipt failed:", (e as Error).message);
  }
  return { text };
}
