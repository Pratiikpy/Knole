import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { embed } from "./embed";
import { extractMemories, retrieveEntries } from "./engine";

const { users, entries, memories, memoryHistory, evalRuns } = schema;

// ── fixtures: five distinct, single-topic entries ───────
const EVAL_ENTRIES = [
  "I went for a long run this morning along the river and felt clearer than I have in weeks.",
  "My sister Mira is visiting next month and I'm equal parts excited and anxious about it.",
  "Work has been crushing — three deadlines collided this week and I barely slept.",
  "I've been learning to bake sourdough; the third loaf finally had a real, crackling crust.",
  "I keep putting off calling the dentist even though the tooth has ached for days.",
];

// query → index of the entry that should be retrieved first (hit@1)
const RETRIEVAL_CASES: { query: string; expected: number }[] = [
  { query: "exercise and feeling mentally clear", expected: 0 },
  { query: "a family visit that makes me nervous", expected: 1 },
  { query: "overwhelmed by work with no sleep", expected: 2 },
  { query: "baking bread at home", expected: 3 },
  { query: "avoiding a medical appointment", expected: 4 },
];

// the extractor should capture the DURABLE facts from the Mira entry — her identity
// and the felt emotion — NOT "visiting next month" (ephemeral; EXTRACT_SYS skips it).
const EXTRACTION_KEYWORDS = ["mira", "sister", "anx"];

export type EvalResult = {
  retrieval: number;
  extraction: number;
  passed: boolean;
  details: {
    retrieval: { query: string; topHit: string; ok: boolean }[];
    extracted: string[];
    covered: string[];
  };
};

async function resetEvalUser(): Promise<string> {
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyId, "eval"))
    .limit(1);
  let userId: string;
  if (found[0]) {
    userId = found[0].id;
    await db.delete(memoryHistory).where(eq(memoryHistory.userId, userId));
    await db.delete(memories).where(eq(memories.userId, userId));
    await db.delete(entries).where(eq(entries.userId, userId));
  } else {
    const ins = await db
      .insert(users)
      .values({ privyId: "eval", email: "eval@knole.local" })
      .returning({ id: users.id });
    userId = ins[0].id;
  }
  return userId;
}

export async function runEvals(): Promise<EvalResult> {
  const userId = await resetEvalUser();

  // seed the entries with real embeddings
  const seeded: { id: string; text: string }[] = [];
  for (const text of EVAL_ENTRIES) {
    const v = await embed(text);
    const [row] = await db
      .insert(entries)
      .values({ userId, text, type: "journal", embedding: v })
      .returning();
    seeded.push({ id: row.id, text });
  }

  // ── retrieval eval: hit@1 ──
  let hits = 0;
  const retrievalDetails: { query: string; topHit: string; ok: boolean }[] = [];
  for (const c of RETRIEVAL_CASES) {
    const qv = await embed(c.query);
    const top = await retrieveEntries(userId, qv, 1);
    const topText = top[0]?.text ?? "";
    const ok = topText === EVAL_ENTRIES[c.expected];
    if (ok) hits++;
    retrievalDetails.push({ query: c.query, topHit: topText.slice(0, 44), ok });
  }
  const retrieval = hits / RETRIEVAL_CASES.length;

  // ── extraction eval: keyword coverage on the Mira entry ──
  const mira = seeded[1];
  const extracted = await extractMemories(userId, mira.id, mira.text);
  const blob = extracted.map((m) => m.content.toLowerCase()).join(" ");
  const covered = EXTRACTION_KEYWORDS.filter((k) => blob.includes(k));
  const extraction = covered.length / EXTRACTION_KEYWORDS.length;

  const retrievalPass = retrieval >= 0.8;
  const extractionPass = extraction >= 0.67;

  await db.insert(evalRuns).values({
    suite: "retrieval@1",
    passed: retrievalPass,
    score: retrieval,
    details: { cases: retrievalDetails },
  });
  await db.insert(evalRuns).values({
    suite: "extraction-coverage",
    passed: extractionPass,
    score: extraction,
    details: { extracted: extracted.map((m) => m.content), covered },
  });

  return {
    retrieval,
    extraction,
    passed: retrievalPass && extractionPass,
    details: { retrieval: retrievalDetails, extracted: extracted.map((m) => m.content), covered },
  };
}
