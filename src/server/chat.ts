import { type ChatMsg } from "./llm";
import { chatPrivate, chatPrivateStream } from "./sealed";
import { retrieveMemories, retrieveEntries, type EntryHit } from "./engine";
import { embed } from "./embed";
import { bestExcerpt } from "./excerpt";
import { parseDateFilters } from "./dateLens";

const CHAT_SYS = `You are Knole — a private, warm, sharp thinking-partner the user talks to. Not a yes-man, not a generic assistant.
- You remember this person across time. Weave in what you genuinely know about them when it helps, naturally — never list facts, never say "according to my notes".
- It's a real conversation: reflect, ask a good question, but you can also offer a perspective or gently push back. Honest, never flattering, never preachy, never clinical.
- Prefer open, gentle questions; avoid the interrogating "why are you…" framing.
- Keep replies short and human — usually 1–4 sentences. Plain prose, no markdown or lists unless asked.

Never assume anyone's gender. Refer to other people by the name used, or as "they" — never "he" or "she" unless the user's own words did first.`;

export type Turn = { role: "user" | "assistant"; content: string };

// ── multi-step retrieval (freenote): the model searches the journal before answering ──
// Instead of native function-calling (model-dependent on the 0G/TEE stack), a tiny JSON protocol:
// a planner call may request up to two focused searches — reformulating its own query, which is
// the whole trick: "what happened in March" becomes a search for "March", not for the user's
// literal phrasing. Results feed the final streamed answer as dated journal excerpts.
const SEARCH_SYS = `You decide whether you need to SEARCH the user's journal before answering their message. You may search when the answer depends on their past - events, dates, people, feelings, commitments, "when did I", "what happened", "have I ever".
When the message points at a TIME PERIOD, append a date filter to the search query using exactly this syntax: dt>="<value>" dt<"<value>" or dt:"<value>" - values may be dates (2026-03-01) or natural words ("last week", "yesterday", "April 2026"). Example: {"search": "argument with Sam dt:\\"last month\\""}
Reply with ONLY one JSON object, nothing else:
{"search": "<one focused search query - name the month/person/topic directly>"} - to look something up
{"ready": true} - when the conversation alone is enough (greetings, opinions, the present moment)`;

export type ChatSearchHit = { query: string; date: string; text: string };

export async function gatherChatContext(
  userId: string,
  history: Turn[],
  message: string,
): Promise<ChatSearchHit[]> {
  const found: ChatSearchHit[] = [];
  const seenQueries = new Set<string>();
  for (let step = 0; step < 2; step++) {
    let decision = "";
    try {
      decision = (
        await chatPrivate(
          [
            { role: "system", content: SEARCH_SYS },
            {
              role: "user",
              content:
                `Conversation so far:\n${history
                  .slice(-4)
                  .map((t) => `${t.role}: ${t.content.slice(0, 300)}`)
                  .join("\n")}\nuser: ${message}` +
                (found.length
                  ? `\n\nAlready found in the journal:\n${found.map((f) => `- [${f.date}] ${f.text.slice(0, 120)}`).join("\n")}`
                  : ""),
            },
          ],
          { temperature: 0, maxTokens: 80 },
        )
      ).content;
    } catch {
      break; // planner down — answer from base context
    }
    const m = decision.match(/\{[\s\S]*\}/);
    if (!m) break;
    let query = "";
    try {
      const parsed = JSON.parse(m[0]) as { search?: unknown; ready?: unknown };
      if (typeof parsed.search === "string" && parsed.search.trim()) query = parsed.search.trim();
    } catch {
      break;
    }
    if (!query || seenQueries.has(query.toLowerCase())) break;
    seenQueries.add(query.toLowerCase());
    // The planner may have emitted a dt-date-filter; strip it before embedding and let it gate
    // the search window ("what did I do in March" only searches March).
    const { cleaned, range } = parseDateFilters(query);
    const qv = await embed(cleaned || query);
    const hits: EntryHit[] = await retrieveEntries(userId, qv, 4, range);
    for (const h of hits) {
      const date = new Date(h.createdAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const excerpt = bestExcerpt(h.text, query, 280);
      if (!found.some((f) => f.text === excerpt)) found.push({ query, date, text: excerpt });
    }
    if (!hits.length) break;
  }
  return found.slice(0, 8);
}

function buildMessages(
  history: Turn[],
  message: string,
  memories: { content: string }[],
  searched: ChatSearchHit[] = [],
  persona = "",
): ChatMsg[] {
  const memBlock = memories.length
    ? `\n\nThings you remember about this person:\n${memories.map((m) => `- ${m.content}`).join("\n")}`
    : "";
  const searchBlock = searched.length
    ? `\n\nFrom their journal (dated — ground any claims about their past in these, and say the date when it helps):\n${searched.map((s) => `- [${s.date}] ${s.text.slice(0, 260)}`).join("\n")}`
    : "";
  return [
    { role: "system", content: CHAT_SYS + persona + memBlock + searchBlock },
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
export function chatReplyStream(
  history: Turn[],
  message: string,
  memories: { content: string }[],
  searched: ChatSearchHit[] = [],
  persona = "",
) {
  return chatPrivateStream(buildMessages(history, message, memories, searched, persona), {
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
