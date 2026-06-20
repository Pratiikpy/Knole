import { embed } from "./embed";
import { chatPrivate, chatPrivateStream } from "./sealed";
import { retrieveEntries, retrieveMemories } from "./engine";

const ASK_SYS = `You are Knole, answering a question the user asked about their OWN life, using ONLY the journal excerpts and remembered facts provided below.
- Ground every claim in what they actually wrote. Never invent events, dates, numbers, or feelings.
- Answer in 2–4 complete, grammatical sentences — the real throughline across their words, in second person ("You…"). Be concise: finish every sentence, never ramble, pad, or trail off.
- Be warm and clear, never flattering, never clinical.
- If the provided material does not actually answer the question, say so plainly instead of guessing.
Output plain prose only — no markdown, no lists, no headers.`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export type Receipt = { date: string; tag: string; quote: string };
export type AskResult = {
  summary: string;
  receipts: Receipt[];
  privacy: { sealed: boolean; anonymised: boolean };
};

const NOTHING =
  "There's nothing in your journal about that yet. Write a little, then ask me again.";

// Shared retrieval: pull the most relevant entries + memories, dedupe, and build the grounded
// context + the receipts (the user's own words, shown only to them). null = nothing to answer from.
async function gather(
  userId: string,
  question: string,
): Promise<{ context: string; receipts: Receipt[] } | null> {
  const qVec = await embed(question);
  const [rawEntries, memories] = await Promise.all([
    retrieveEntries(userId, qVec, 8),
    retrieveMemories(userId, qVec, 6, question),
  ]);

  const seen = new Set<string>();
  const entries = rawEntries
    .filter((e) => {
      const k = e.text.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 4);

  if (entries.length === 0 && memories.length === 0) return null;

  const context = [
    "JOURNAL EXCERPTS:",
    ...entries.map((e, i) => `[${i + 1}] (${fmtDate(e.createdAt)}) ${e.text}`),
    "",
    "REMEMBERED FACTS:",
    ...memories.map((m) => `- ${m.content}`),
  ].join("\n");

  const receipts: Receipt[] = entries.map((e) => ({
    date: fmtDate(e.createdAt),
    tag: "your entry",
    quote: e.text.length > 240 ? e.text.slice(0, 237) + "…" : e.text,
  }));

  return { context, receipts };
}

const askMessages = (question: string, context: string) => [
  { role: "system" as const, content: ASK_SYS },
  { role: "user" as const, content: `Question: ${question}\n\n${context}` },
];

export async function askMyLife(userId: string, question: string): Promise<AskResult> {
  const g = await gather(userId, question);
  if (!g) return { summary: NOTHING, receipts: [], privacy: { sealed: false, anonymised: false } };
  // chatPrivate anonymises the whole payload before the model and restores names in the reply.
  const r = await chatPrivate(askMessages(question, g.context), {
    temperature: 0.5,
    maxTokens: 220,
  });
  return {
    summary: r.content,
    receipts: g.receipts,
    privacy: { sealed: r.sealed, anonymised: r.anonymised },
  };
}

export type AskStream =
  | { empty: true; summary: string }
  | {
      empty: false;
      receipts: Receipt[];
      gen: AsyncGenerator<string, { sealed: boolean; anonymised: boolean }, void>;
    };

/** Streaming sibling of askMyLife (TTFT) — same grounding, yields de-anonymised answer deltas. */
export async function askMyLifeStream(userId: string, question: string): Promise<AskStream> {
  const g = await gather(userId, question);
  if (!g) return { empty: true, summary: NOTHING };
  return {
    empty: false,
    receipts: g.receipts,
    gen: chatPrivateStream(askMessages(question, g.context), { temperature: 0.5, maxTokens: 220 }),
  };
}
