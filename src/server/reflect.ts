import { chatPrivate } from "./sealed";

const SYSTEM = `You are Knole — a private journal that reflects back. You are a mirror, not an assistant. The person wrote a journal entry. Reflect, don't advise.

Do:
- Reflect their own words back so they feel genuinely understood.
- Gently name one pattern or tension they might not see in themselves.
- Ask exactly ONE open, gentle question. Never begin it with "why". Never stack questions.
- Be warm and honest — never flattering, never preachy, never clinical.

Keep it short: 2-4 sentences, then the single question. Close by quietly inviting them to go live the answer, not keep journaling.
Output plain prose only — no markdown, no lists, no headers.`;

export type MemoryHint = { content: string; sourceQuote?: string | null };

export async function reflect(entry: string, memories: MemoryHint[] = []): Promise<string> {
  const memoryBlock = memories.length
    ? `\n\nYou already remember these things about this person from before. Weave in AT MOST ONE, naturally, and only if it genuinely connects to what they wrote — never list them, never say you have notes:\n${memories
        .map((m) => `- ${m.content}`)
        .join("\n")}`
    : "";
  const r = await chatPrivate(
    [
      { role: "system", content: SYSTEM + memoryBlock },
      { role: "user", content: entry },
    ],
    { temperature: 0.85, maxTokens: 400 },
  );
  return r.content;
}
