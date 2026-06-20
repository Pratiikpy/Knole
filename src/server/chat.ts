import { type ChatMsg } from "./llm";
import { chatPrivate } from "./sealed";
import { retrieveMemories } from "./engine";

const CHAT_SYS = `You are Knole — a private, warm, sharp thinking-partner the user talks to. Not a yes-man, not a generic assistant.
- You remember this person across time. Weave in what you genuinely know about them when it helps, naturally — never list facts, never say "according to my notes".
- It's a real conversation: reflect, ask a good question, but you can also offer a perspective or gently push back. Honest, never flattering, never preachy, never clinical.
- Prefer open, gentle questions; avoid the interrogating "why are you…" framing.
- Keep replies short and human — usually 1–4 sentences. Plain prose, no markdown or lists unless asked.`;

export type Turn = { role: "user" | "assistant"; content: string };

export async function chatReply(
  userId: string,
  history: Turn[],
  message: string,
  qVec: number[],
): Promise<string> {
  const memories = await retrieveMemories(userId, qVec, 6, message);
  const memBlock = memories.length
    ? `\n\nThings you remember about this person:\n${memories.map((m) => `- ${m.content}`).join("\n")}`
    : "";
  const msgs: ChatMsg[] = [
    { role: "system", content: CHAT_SYS + memBlock },
    ...history.slice(-10).map((t) => ({ role: t.role, content: t.content }) as ChatMsg),
    { role: "user", content: message },
  ];
  // chatPrivate anonymises every prompt before the model and restores names in the reply.
  const r = await chatPrivate(msgs, { temperature: 0.8, maxTokens: 500 });
  return r.content;
}
