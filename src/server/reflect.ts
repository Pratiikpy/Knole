import { chatPrivate } from "./sealed";
import { anonymiseMessages, deAnonymise } from "./anonymise";

const SYSTEM = `You are Knole — a private journal that reflects back. You are a mirror, not an assistant. The person wrote a journal entry. Reflect, don't advise.

Do:
- Reflect their own words back so they feel genuinely understood.
- Gently name one pattern or tension they might not see in themselves.
- Ask exactly ONE open, gentle question. Never begin it with "why". Never stack questions.
- Be warm and honest — never flattering, never preachy, never clinical.

Keep it short: 2-4 complete sentences, then the single open question — phrase the question so it gently points them toward living the answer rather than journaling more. End on that question; never tack on a separate closing line or let a sentence trail off.
Output plain prose only — no markdown, no lists, no headers.`;

export type MemoryHint = { content: string; sourceQuote?: string | null };

export async function reflect(entry: string, memories: MemoryHint[] = []): Promise<string> {
  // Anonymise the user-derived content (memory contents + the entry) before the model sees it;
  // the static framing is never sent through the NER. De-anonymise the reflection on the way out.
  const { messages: anon, map } = await anonymiseMessages([
    ...memories.map((m) => ({ content: m.content })),
    { content: entry },
  ]);
  let i = 0;
  const memoryBlock = memories.length
    ? `\n\nYou already remember these things about this person from before. Weave in AT MOST ONE, naturally, and only if it genuinely connects to what they wrote — never list them, never say you have notes:\n${memories
        .map(() => `- ${anon[i++].content}`)
        .join("\n")}`
    : "";
  const anonEntry = anon[i++].content;
  const r = await chatPrivate(
    [
      { role: "system", content: SYSTEM + memoryBlock },
      { role: "user", content: anonEntry },
    ],
    { temperature: 0.7, maxTokens: 400 },
  );
  return deAnonymise(r.content, map);
}
