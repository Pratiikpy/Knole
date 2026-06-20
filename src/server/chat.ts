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
