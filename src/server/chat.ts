import { type ChatMsg } from "./llm";
import { chatPrivate } from "./sealed";
import { retrieveMemories } from "./engine";
import { anonymiseMessages, deAnonymise } from "./anonymise";

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
  const hist = history.slice(-10);

  // Anonymise everything the user wrote — memory contents, prior turns, the new message — under one
  // shared token map, so no raw PII reaches the model. The static framing (CHAT_SYS) is never run
  // through the NER. The reply is de-anonymised back to real names before the user sees it.
  const { messages: anon, map } = await anonymiseMessages([
    ...memories.map((m) => ({ content: m.content })),
    ...hist.map((t) => ({ content: t.content })),
    { content: message },
  ]);
  let i = 0;
  const memBlock = memories.length
    ? `\n\nThings you remember about this person:\n${memories.map(() => `- ${anon[i++].content}`).join("\n")}`
    : "";
  const histMsgs = hist.map((t) => ({ role: t.role, content: anon[i++].content }) as ChatMsg);
  const userMsg = anon[i++].content;

  const msgs: ChatMsg[] = [
    { role: "system", content: CHAT_SYS + memBlock },
    ...histMsgs,
    { role: "user", content: userMsg },
  ];
  const r = await chatPrivate(msgs, { temperature: 0.8, maxTokens: 500 });
  return deAnonymise(r.content, map);
}
