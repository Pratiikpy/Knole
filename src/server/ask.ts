import { embed } from "./embed";
import { chatPrivate } from "./sealed";
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

export type AskResult = {
  summary: string;
  receipts: { date: string; tag: string; quote: string }[];
};

export async function askMyLife(userId: string, question: string): Promise<AskResult> {
  const qVec = await embed(question);
  const [rawEntries, memories] = await Promise.all([
    retrieveEntries(userId, qVec, 8),
    retrieveMemories(userId, qVec, 6, question),
  ]);

  // dedupe near-identical entries (same text journaled more than once)
  const seen = new Set<string>();
  const entries = rawEntries
    .filter((e) => {
      const k = e.text.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 4);

  if (entries.length === 0 && memories.length === 0) {
    return {
      summary: "There's nothing in your journal about that yet. Write a little, then ask me again.",
      receipts: [],
    };
  }

  const context = [
    "JOURNAL EXCERPTS:",
    ...entries.map((e, i) => `[${i + 1}] (${fmtDate(e.createdAt)}) ${e.text}`),
    "",
    "REMEMBERED FACTS:",
    ...memories.map((m) => `- ${m.content}`),
  ].join("\n");

  const r = await chatPrivate(
    [
      { role: "system", content: ASK_SYS },
      { role: "user", content: `Question: ${question}\n\n${context}` },
    ],
    { temperature: 0.5, maxTokens: 220 },
  );
  const summary = r.content;

  const receipts = entries.map((e) => ({
    date: fmtDate(e.createdAt),
    tag: "your entry",
    quote: e.text.length > 240 ? e.text.slice(0, 237) + "…" : e.text,
  }));

  return { summary, receipts };
}
