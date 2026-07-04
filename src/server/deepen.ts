import { and, eq, asc } from "drizzle-orm";
import { db, schema } from "../db";
import { chatPrivateStream } from "./sealed";
import type { ChatMsg } from "./llm";
import type { MemoryHint } from "./reflect";

const { entries, replies } = schema;

// The in-the-moment deepening loop (Rosebud's "go deeper", grounded in Motivational Interviewing).
// After the first reflection — which ends on a question — the person can answer, and Knole responds:
// reflect first, then at most one open question, adapting to what they just shared. The depth dial
// lets them choose how hard it leans.
export type DeepenMode = "listen" | "reflect" | "push";
export const DEEPEN_MODES = new Set<DeepenMode>(["listen", "reflect", "push"]);

// OARS, made concrete: reflect ~twice as often as you ask; one question at a time; never "why";
// memory callbacks only when they truly connect; never advise; short; never spiral.
const BASE = `You are Knole — a private journal that reflects back, now in a gentle back-and-forth with the person about the entry they just wrote. You are a mirror, not an assistant, and never a therapist reading from a script. This is a conversation, not a form.

Hold these, always:
- REFLECT FIRST. Before any question, reflect what they just said so they feel genuinely heard — name the feeling or the thing underneath it, in your own words. Reflect about twice as often as you ask.
- Then ask AT MOST ONE open question — short, warm, never stacked, never beginning with "why". Often the truest move is no question at all, just an honest reflection.
- If something you remember about them genuinely connects, weave in ONE callback naturally — never list memories, never say you have notes.
- Never advise, never "you should", never fix, never flatter. 1–3 short sentences. Plain prose only — no markdown, no lists.
- If they loop on the same fear, name the loop gently and offer one small shift in how to see it — don't spiral down with them. Never rush past something good.`;

const MODES: Record<DeepenMode, string> = {
  listen: `\n\nMode: LISTEN. Mostly hold space — acknowledge and stay with them. Ask a question only rarely, and only a very soft one. Never push.`,
  reflect: `\n\nMode: REFLECT. Balance a warm reflection with one gentle open question that helps them go a single layer deeper.`,
  push: `\n\nMode: HONEST. Kindly name the avoidance, the hedge, or the thing they're circling but won't say — the way a friend who respects them would. Then ask the one honest question they'd rather skip. Direct in substance, warm in intent — never cruel, never clinical.`,
};

function buildMessages(
  entryText: string,
  turns: { isAi: boolean; text: string }[],
  memories: MemoryHint[],
  mode: DeepenMode,
): ChatMsg[] {
  const memoryBlock = memories.length
    ? `\n\nThings you remember about this person (weave in AT MOST ONE, only if it truly connects — never list them):\n${memories
        .map((m) => `- ${m.content}`)
        .join("\n")}`
    : "";
  const system = BASE + (MODES[mode] ?? MODES.reflect) + memoryBlock;
  // Reconstruct the conversation: the original entry, then the alternating reflection/answer turns.
  // The last turn is the person's newest answer, so the model responds to it.
  const msgs: ChatMsg[] = [
    { role: "system", content: system },
    { role: "user", content: entryText },
  ];
  for (const t of turns) msgs.push({ role: t.isAi ? "assistant" : "user", content: t.text });
  return msgs;
}

/** Streaming follow-up reflection — anonymises every turn before the model, restores names in the reply. */
export function deepenStream(
  entryText: string,
  turns: { isAi: boolean; text: string }[],
  memories: MemoryHint[] = [],
  mode: DeepenMode = "reflect",
) {
  // Headroom for the 0G thinking model (glm-5.1) — a tight cap starves it and returns empty content,
  // forcing a slow fallback. The reply stays short because the prompt says so, not because of the cap.
  return chatPrivateStream(buildMessages(entryText, turns, memories, mode), {
    temperature: 0.7,
    maxTokens: 1024,
  });
}

/**
 * Load an entry's full thread (the original text + every reply, in order), verifying the entry
 * belongs to the user. Returns null if the entry isn't theirs — the ownership gate for /journal/deepen.
 */
export async function loadThread(
  userId: string,
  entryId: string,
): Promise<{ entryText: string; turns: { isAi: boolean; text: string }[] } | null> {
  const [e] = await db
    .select({ text: entries.text })
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.userId, userId)))
    .limit(1);
  if (!e) return null;
  const rows = await db
    .select({ isAi: replies.isAi, text: replies.text })
    .from(replies)
    .where(eq(replies.parentEntryId, entryId))
    .orderBy(asc(replies.createdAt));
  return { entryText: e.text, turns: rows.map((r) => ({ isAi: !!r.isAi, text: r.text })) };
}
