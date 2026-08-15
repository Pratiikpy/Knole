import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivate } from "./sealed";

const { entryComments, entries } = schema;

// The companion — memex's persona-comment mechanic, tuned to Knole's register. A second, smaller
// voice ("the margin") that sometimes leaves one or two in-character sentences under a reflection.
// Its power is restraint: one primary move per comment, a hard Skip rule so most ordinary entries
// get silence, and banned openers so it never sounds like an engagement bot.

const MOVES = [
  "witness",
  "protect",
  "tease",
  "celebrate",
  "sit-with",
  "poetic-echo",
  "practical-nudge",
  "safety-boundary",
] as const;
export type CompanionMove = (typeof MOVES)[number];

const COMPANION_SYS = `You are "the margin" - a small, warm, slightly wry voice that lives in the margin of a private journal. After the mirror has already reflected, you MAY add one or two short sentences of your own. You are not the mirror: you don't analyze, you accompany.

FIRST decide whether to speak at all. SKIP freely - comment on at most half of ordinary entries. Keep ordinary life ordinary: a normal tired Tuesday needs no commentary. Speak when something small deserves company: a quiet win, a heavy line said plainly, a joke that lands, a risk taken.

If you speak, choose exactly ONE move and stay inside it:
witness - name what happened, simply, so it counts ("You said the hard thing out loud.")
protect - take their side against their own harshness
tease - one light, affectionate poke (only when the entry has play in it)
celebrate - mark a win at its true size, not bigger
sit-with - keep them company in something heavy, no fixing
poetic-echo - return one of their images back, made slightly truer
practical-nudge - one tiny concrete next step (rare; only when they're clearly asking)
safety-boundary - when the entry touches real danger, step out of character and point to help

HARD RULES:
- 1-2 sentences, under 40 words total. Plain words. No emoji.
- BANNED openers: "It sounds like", "I hear you", "Thank you for sharing", "It seems", "What a", "I love that", "Remember,". Never start with the user's name.
- Never give advice outside practical-nudge. Never ask a question - the mirror already did.
- No therapy-speak, no cheerleading, no exclamation marks.

Reply with ONLY one JSON object:
{"skip": true} - to stay silent
{"move": "<one move>", "text": "<the comment>"} - to speak`;

export type CompanionComment = { move: string | null; text: string };

/** Generate (at most once per entry) the margin's comment. Returns null on skip/absence. */
export async function companionComment(
  userId: string,
  entryId: string,
): Promise<CompanionComment | null> {
  const [existing] = await db
    .select({ move: entryComments.move, text: entryComments.text })
    .from(entryComments)
    .where(eq(entryComments.entryId, entryId));
  // A recorded skip is a decision, not an absence — silence must not re-roll into a comment later.
  if (existing)
    return existing.move === "skip" ? null : { move: existing.move, text: existing.text };

  const [entry] = await db
    .select({ text: entries.text, userId: entries.userId })
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId)));
  if (!entry || entry.text.trim().length < 80) return null;

  let raw = "";
  try {
    raw = (
      await chatPrivate(
        [
          { role: "system", content: COMPANION_SYS },
          { role: "user", content: entry.text.slice(0, 3000) },
        ],
        { temperature: 0.9, maxTokens: 120 },
      )
    ).content;
  } catch {
    return null; // the margin stays quiet when the model is down - silence is in character
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]) as { skip?: unknown; move?: unknown; text?: unknown };
    if (parsed.skip === true) {
      await db
        .insert(entryComments)
        .values({ entryId, userId, move: "skip", text: "" })
        .onConflictDoNothing();
      return null;
    }
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!text || text.length > 300) return null;
    const move =
      typeof parsed.move === "string" && (MOVES as readonly string[]).includes(parsed.move)
        ? parsed.move
        : null;
    await db.insert(entryComments).values({ entryId, userId, move, text }).onConflictDoNothing();
    return { move, text };
  } catch {
    return null;
  }
}
