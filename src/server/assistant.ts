import { embed } from "./embed";
import { chatPrivateStream } from "./sealed";
import { retrieveMemories } from "./engine";
import { currentUserId } from "./session";
import { enforceRate } from "./rateLimit";
import { detectCrisis, CRISIS_REPLY } from "./safety";
import type { ChatMsg } from "./llm";

// "Ask Knole anything" (Part 7A) — the private general assistant, the on-brand counter to a generic
// chatbot. Everything runs the same anonymise → 0G TEE → private path Knole uses for reflection, AND
// it quietly draws on the person's own memory when it helps. Not journaling: these turns are utility,
// held only in the client session, never saved to the journal — so it's a private ChatGPT that knows
// you and can't read your data.

const ASSISTANT_SYS = `You are Knole — a private, thoughtful assistant. You help with anything the person asks: thinking something through, drafting a message, weighing a decision, answering a question. You are private by design: their name and details are stripped before you ever see them, and nothing here is saved to their journal.

- Be genuinely helpful, clear, and warm. Answer the actual question well.
- You quietly know this person from their journal. When it GENUINELY helps, draw on what you remember — their situation, values, the people and patterns in their life — so the answer fits them. Never force it, never list what you know, never say "I have notes."
- When they ask you to write something (an email, a hard message, a plan), write it well, in their voice where you can tell it.
- Honest, never a yes-man. If something seems like a bad idea, say so kindly.
- Plain prose unless they ask for structure.`;

export type AssistantTurn = { role: "you" | "knole"; text: string };

function buildMessages(
  question: string,
  memories: { content: string }[],
  history: AssistantTurn[],
): ChatMsg[] {
  const memoryBlock = memories.length
    ? `\n\nWhat you remember about this person (use only if it truly helps this request):\n${memories
        .map((m) => `- ${m.content}`)
        .join("\n")}`
    : "";
  const msgs: ChatMsg[] = [{ role: "system", content: ASSISTANT_SYS + memoryBlock }];
  for (const h of history.slice(-8))
    msgs.push({ role: h.role === "you" ? "user" : "assistant", content: h.text });
  msgs.push({ role: "user", content: question });
  return msgs;
}

/** The private, memory-grounded answer generator — anonymised before the model, de-anonymised out. */
export function assistantStream(
  question: string,
  memories: { content: string }[] = [],
  history: AssistantTurn[] = [],
) {
  return chatPrivateStream(buildMessages(question, memories, history), {
    temperature: 0.7,
    maxTokens: 1500,
  });
}

/**
 * Streaming assistant endpoint (POST /assistant/stream). A READ (currentUserId — the demo can try it),
 * so no entry is saved. Retrieves relevant memories to ground the answer, then streams it de-anonymised.
 */
export async function handleAssistantStream(request: Request): Promise<Response> {
  const txt = (status: number, body: string) => new Response(body, { status });

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return txt(403, "forbidden");
  try {
    enforceRate("assistant", 30, 60_000);
  } catch {
    return txt(429, "slow down a moment");
  }

  let question = "";
  let history: AssistantTurn[] = [];
  try {
    const body = (await request.json()) as { question?: string; history?: AssistantTurn[] };
    question = String(body.question ?? "").trim();
    if (Array.isArray(body.history))
      history = body.history
        .filter((h) => h && (h.role === "you" || h.role === "knole") && typeof h.text === "string")
        .map((h) => ({ role: h.role, text: String(h.text).slice(0, 8000) }));
  } catch {
    /* invalid JSON → caught by the length check */
  }
  if (question.length < 1 || question.length > 8000)
    return txt(400, "question must be 1–8000 chars");

  // A feeling-probing assistant will meet crisis moments too — hand off to real help, never advise.
  if (detectCrisis(question).crisis) {
    return new Response(CRISIS_REPLY, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-knole-crisis": "1",
      },
    });
  }

  const userId = await currentUserId();
  const qVec = await embed(question);
  const memories = await retrieveMemories(userId, qVec, 6, question);
  const gen = chatPrivateStream(buildMessages(question, memories, history), {
    temperature: 0.7,
    maxTokens: 1500,
  });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let any = false;
      try {
        for await (const delta of gen) {
          any = true;
          controller.enqueue(enc.encode(delta));
        }
        if (!any) controller.enqueue(enc.encode("I lost my footing there — ask me again?"));
      } catch (e) {
        console.error("assistant-stream failed:", (e as Error).message);
        if (!any)
          controller.enqueue(enc.encode("Something interrupted me — try again in a moment."));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
      "x-knole-recalled": String(memories.length),
    },
  });
}
