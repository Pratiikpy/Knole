import { type ChatMsg } from "./llm";
import { chatPrivate, chatPrivateStream } from "./sealed";
import { retrieveMemories } from "./engine";

const CHAT_SYS = `You are Knole — a private, warm, sharp thinking-partner the user talks to. Not a yes-man, not a generic assistant.
- You remember this person across time. Weave in what you genuinely know about them when it helps, naturally — never list facts, never say "according to my notes".
- It's a real conversation: reflect, ask a good question, but you can also offer a perspective or gently push back. Honest, never flattering, never preachy, never clinical.
- Prefer open, gentle questions; avoid the interrogating "why are you…" framing.
- Keep replies short and human — usually 1–4 sentences. Plain prose, no markdown or lists unless asked.`;

export type Turn = { role: "user" | "assistant"; content: string };

function buildMessages(
  history: Turn[],
  message: string,
  memories: { content: string }[],
): ChatMsg[] {
  const memBlock = memories.length
    ? `\n\nThings you remember about this person:\n${memories.map((m) => `- ${m.content}`).join("\n")}`
    : "";
  return [
    { role: "system", content: CHAT_SYS + memBlock },
    ...history.slice(-10).map((t) => ({ role: t.role, content: t.content }) as ChatMsg),
    { role: "user", content: message },
  ];
}

// chatPrivate / chatPrivateStream anonymise every prompt before the model and restore names in the reply.
export async function chatReply(
  userId: string,
  history: Turn[],
  message: string,
  qVec: number[],
): Promise<string> {
  const memories = await retrieveMemories(userId, qVec, 6, message);
  const r = await chatPrivate(buildMessages(history, message, memories), {
    temperature: 0.8,
    maxTokens: 500,
  });
  return r.content;
}

/**
 * Streaming sibling of chatReply for TTFT — same prompt, yields de-anonymised deltas. Memories are
 * pre-retrieved by the caller (the streaming endpoint embeds once and reuses the vector for the
 * saved entry), so this just builds the prompt and streams.
 */
export function chatReplyStream(history: Turn[], message: string, memories: { content: string }[]) {
  return chatPrivateStream(buildMessages(history, message, memories), {
    temperature: 0.8,
    maxTokens: 500,
  });
}

const COMPOSE_SYS = `You are Knole. Read this conversation between the user and Knole, then write it back as ONE journal entry in the user's own first-person voice — what THEY would write, not a summary about them. Never write "the user" or "you"; write as "I". Keep their tone and their words where you can.
Return ONLY JSON, nothing around it:
{"title": "<=8 words, evocative not generic>", "body": "<the entry, first person, 1-4 short paragraphs>", "tags": ["<1-5 lowercase topical tags>"], "mood": "<one lowercase word, or null>"}`;

/**
 * Compose a whole chat thread into ONE first-person journal entry (the "turn this into an entry"
 * action). chatPrivate anonymises the full transcript before the model and restores names after, so
 * the privacy guarantee holds. Parses JSON defensively (extractMemories-style) with a deterministic
 * fallback so compose never fails silently.
 */
export async function composeEntry(
  history: Turn[],
): Promise<{ title: string; body: string; tags: string[]; mood: string | null }> {
  const transcript = history
    .map((t) => `${t.role === "user" ? "You" : "Knole"}: ${t.content}`)
    .join("\n");
  const fallbackBody = history
    .filter((t) => t.role === "user")
    .map((t) => t.content)
    .join("\n\n");
  const fallbackTitle = (history.find((t) => t.role === "user")?.content ?? "A conversation")
    .slice(0, 48)
    .trim();
  try {
    const r = await chatPrivate(
      [
        { role: "system", content: COMPOSE_SYS },
        { role: "user", content: transcript },
      ],
      { temperature: 0.4, maxTokens: 700 },
    );
    const m = r.content.match(/\{[\s\S]*\}/);
    if (!m) return { title: fallbackTitle, body: fallbackBody, tags: [], mood: null };
    const parsed = JSON.parse(m[0]) as {
      title?: unknown;
      body?: unknown;
      tags?: unknown;
      mood?: unknown;
    };
    const body =
      typeof parsed.body === "string" && parsed.body.trim() ? parsed.body.trim() : fallbackBody;
    const title =
      typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallbackTitle;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.toLowerCase().trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];
    const mood =
      typeof parsed.mood === "string" && parsed.mood.trim()
        ? parsed.mood.toLowerCase().trim()
        : null;
    return { title, body, tags, mood };
  } catch {
    return { title: fallbackTitle, body: fallbackBody, tags: [], mood: null };
  }
}
