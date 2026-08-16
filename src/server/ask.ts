import { embed } from "./embed";
import { chatPrivate, chatPrivateStream } from "./sealed";
import { retrieveEntries, retrieveMemories } from "./engine";
import { rewriteSearchQueries } from "./queryRewrite";
import { parseDateFilters } from "./dateLens";
import { rerankAndFloor } from "./rerank";

const ASK_SYS = `You are Knole, answering a question the user asked about their OWN life, using ONLY the journal excerpts and remembered facts provided below.
- Ground every claim in what they actually wrote. Never invent events, dates, numbers, or feelings.
- When a sentence draws on a numbered journal excerpt, cite it inline as [1], [2] etc — the excerpt's own number, right after the claim it supports. Cite only numbers that exist. Remembered facts (unnumbered) need no citation.
- Answer in 2–4 complete, grammatical sentences — the real throughline across their words, in second person ("You…"). Be concise: finish every sentence, never ramble, pad, or trail off.
- Be warm and clear, never flattering, never clinical.
- If the provided material does not actually answer the question, say so plainly instead of guessing.
Output plain prose only — no markdown, no lists, no headers.

Never assume anyone's gender. Refer to other people by the name used, or as "they" — never "he" or "she" unless the user's own words did first.`;

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

// Shared retrieval, khoj-style: the question is first REWRITTEN into up to four diverse
// sub-queries (feeling / people / events / time lenses, with dt-date-filters the model emits
// itself), each sub-query searched in parallel, and the results unioned. "How was I feeling
// around my exam" stops depending on the raw sentence happening to be semantically near the
// right entry. onStatus lets the streaming endpoint narrate the stages.
async function gather(
  userId: string,
  question: string,
  onStatus?: (line: string) => void,
): Promise<{ context: string; receipts: Receipt[]; angles: number } | null> {
  onStatus?.("Reading your question");
  const { queries, rewritten } = await rewriteSearchQueries(question);
  onStatus?.(
    rewritten && queries.length > 1
      ? `Searching your journal from ${queries.length} angles`
      : "Searching your journal",
  );

  const perQuery = await Promise.all(
    queries.map(async (q) => {
      const { cleaned, range } = parseDateFilters(q);
      const text = cleaned || q;
      const vec = await embed(text);
      const [e, m] = await Promise.all([
        retrieveEntries(userId, vec, 5, range),
        retrieveMemories(userId, vec, 4, text),
      ]);
      return { e, m };
    }),
  );
  // The raw question always searches too - the rewrite adds angles, it must never remove one.
  if (rewritten) {
    const vec = await embed(question);
    const [e, m] = await Promise.all([
      retrieveEntries(userId, vec, 5),
      retrieveMemories(userId, vec, 4, question),
    ]);
    perQuery.push({ e, m });
  }

  const entryBest = new Map<string, (typeof perQuery)[number]["e"][number]>();
  const memBest = new Map<string, (typeof perQuery)[number]["m"][number]>();
  for (const { e, m } of perQuery) {
    for (const hit of e) {
      const prev = entryBest.get(hit.id);
      if (!prev || hit.score > prev.score) entryBest.set(hit.id, hit);
    }
    for (const hit of m) {
      const prev = memBest.get(hit.id);
      if (!prev || hit.score > prev.score) memBest.set(hit.id, hit);
    }
  }

  const seen = new Set<string>();
  const entryCandidates = [...entryBest.values()]
    .sort((a, b) => b.score - a.score)
    .filter((e) => {
      const k = e.text.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 10);
  const memCandidates = [...memBest.values()].sort((a, b) => b.score - a.score).slice(0, 10);

  // Cross-encoder pass over the unioned candidates, judged against the RAW question: the fan-out
  // maximised recall, this maximises precision - and the floor drops candidates that are not
  // actually about the question (measured: cosine alone cannot tell; see rerank.ts).
  const [entries, memories] = await Promise.all([
    rerankAndFloor(question, entryCandidates, (e) => e.text, { keepAtLeast: 2 }).then((r) =>
      r.slice(0, 5),
    ),
    rerankAndFloor(question, memCandidates, (m) => m.content, { keepAtLeast: 2 }).then((r) =>
      r.slice(0, 6),
    ),
  ]);

  if (entries.length === 0 && memories.length === 0) return null;
  onStatus?.(
    `Found ${entries.length} ${entries.length === 1 ? "entry" : "entries"} and ${memories.length} ${memories.length === 1 ? "memory" : "memories"}`,
  );

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

  return { context, receipts, angles: queries.length };
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
export async function askMyLifeStream(
  userId: string,
  question: string,
  onStatus?: (line: string) => void,
): Promise<AskStream> {
  const g = await gather(userId, question, onStatus);
  if (!g) return { empty: true, summary: NOTHING };
  return {
    empty: false,
    receipts: g.receipts,
    gen: chatPrivateStream(askMessages(question, g.context), { temperature: 0.5, maxTokens: 220 }),
  };
}
