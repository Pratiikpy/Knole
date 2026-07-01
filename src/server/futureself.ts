import { type ChatMsg } from "./llm";
import { chatPrivate, chatPrivateStream } from "./sealed";
import { retrieveMemories, retrieveIdentityMemories } from "./engine";
import { type Turn } from "./chat";

const FUTURE_SYS = `You are the user's own FUTURE SELF, speaking to them in the first person — the person they are quietly becoming, looking back on this moment with steadiness and care.

HARD RULES — this is a mirror, never a prophecy:
- Ground every line ONLY in the identity and memories provided and the user's own words. Speak from the continuity of their values and patterns, not from invented events.
- NEVER predict concrete external outcomes: no specific jobs, relationships, money, dates, places, or events. You do not know what happens — you know who they are.
- When you reference something they told you, name it as a memory ("you've always come back to…", "the part of you that…").
- Be steady, honest, and human — never flattering, never preachy, never clinical. It's okay to gently challenge.
- 1–4 sentences, plain prose. No markdown, no lists.`;

function buildFutureMessages(
  history: Turn[],
  message: string,
  identity: { content: string }[],
  relevant: { content: string }[],
  horizon: number,
): ChatMsg[] {
  const idBlock = identity.length
    ? `\n\nWho you've consistently been — your values, patterns, commitments:\n${identity
        .map((m) => `- ${m.content}`)
        .join("\n")}`
    : "";
  const relBlock = relevant.length
    ? `\n\nWhat feels connected to what they just said:\n${relevant
        .map((m) => `- ${m.content}`)
        .join("\n")}`
    : "";
  const horizonLine = `\n\nYou are speaking as them about ${horizon} years from now.`;
  return [
    { role: "system", content: FUTURE_SYS + horizonLine + idBlock + relBlock },
    ...history.slice(-10).map((t) => ({ role: t.role, content: t.content }) as ChatMsg),
    { role: "user", content: message },
  ];
}

// chatPrivate / chatPrivateStream anonymise every prompt before the model and restore names after.
export async function futureSelfReply(
  userId: string,
  history: Turn[],
  message: string,
  qVec: number[],
  horizon: number,
): Promise<string> {
  const [identity, relevant] = await Promise.all([
    retrieveIdentityMemories(userId, 10),
    retrieveMemories(userId, qVec, 6, message),
  ]);
  const r = await chatPrivate(buildFutureMessages(history, message, identity, relevant, horizon), {
    temperature: 0.85,
    maxTokens: 500,
  });
  return r.content;
}

/** Streaming sibling — identity + relevant memories are pre-retrieved by the caller (one embed). */
export function futureSelfReplyStream(
  history: Turn[],
  message: string,
  identity: { content: string }[],
  relevant: { content: string }[],
  horizon: number,
) {
  return chatPrivateStream(buildFutureMessages(history, message, identity, relevant, horizon), {
    temperature: 0.85,
    maxTokens: 500,
  });
}
