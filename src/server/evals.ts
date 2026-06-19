import { createHash } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { embed, toVectorLiteral } from "./embed";
import { extractMemories, retrieveEntries, retrieveMemories } from "./engine";
import { reflect } from "./reflect";
import { chat } from "./llm";

const { users, entries, memories, memoryHistory, evalRuns } = schema;

// ── fixtures: five distinct, single-topic entries ───────
const EVAL_ENTRIES = [
  "I went for a long run this morning along the river and felt clearer than I have in weeks.",
  "My sister Mira is visiting next month and I'm equal parts excited and anxious about it.",
  "Work has been crushing — three deadlines collided this week and I barely slept.",
  "I've been learning to bake sourdough; the third loaf finally had a real, crackling crust.",
  "I keep putting off calling the dentist even though the tooth has ached for days.",
];

const RETRIEVAL_CASES: { query: string; expected: number }[] = [
  { query: "exercise and feeling mentally clear", expected: 0 },
  { query: "a family visit that makes me nervous", expected: 1 },
  { query: "overwhelmed by work with no sleep", expected: 2 },
  { query: "baking bread at home", expected: 3 },
  { query: "avoiding a medical appointment", expected: 4 },
];

// Durable identity the extractor captures reliably (not the stochastic emotion).
const EXTRACTION_KEYWORDS = ["mira", "sister"];

// Entries to test that reflections invent no concrete facts.
const GROUND_ENTRIES = [
  "I finally fixed the leaky faucet in the upstairs bathroom after putting it off for a month.",
  "I had coffee alone this morning and realized I haven't been alone with my thoughts in a while.",
];

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const hashOf = (s: string) => createHash("sha256").update(s).digest("hex");

export type EvalResult = {
  retrieval1: number;
  retrieval3: number;
  extraction: number;
  dedup: boolean;
  groundedness: number;
  reconcile: boolean;
  recall: boolean;
  hybrid: boolean;
  passed: boolean;
  details: Record<string, unknown>;
};

async function resetEvalUser(): Promise<string> {
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyId, "eval"))
    .limit(1);
  if (found[0]) {
    const userId = found[0].id;
    await db.delete(memoryHistory).where(eq(memoryHistory.userId, userId));
    await db.delete(memories).where(eq(memories.userId, userId));
    await db.delete(entries).where(eq(entries.userId, userId));
    return userId;
  }
  const ins = await db
    .insert(users)
    .values({ privyId: "eval", email: "eval@knole.local" })
    .returning({ id: users.id });
  return ins[0].id;
}

// Mirror the engine's content-hash UPSERT (used by the dedup eval).
async function upsertMemory(userId: string, entryId: string, content: string): Promise<string> {
  const ch = hashOf(normalize(content));
  const v = await embed(content);
  await db.execute(sql`
    INSERT INTO memories
      (user_id, content, content_hash, type, status, source_entry_id, embedding, confidence, importance)
    VALUES
      (${userId}, ${content}, ${ch}, 'fact', 'active', ${entryId}, ${toVectorLiteral(v)}::vector, 0.7, 0.6)
    ON CONFLICT (user_id, content_hash)
      DO UPDATE SET recall_count = memories.recall_count + 1, updated_at = now()
  `);
  return ch;
}

export async function runEvals(): Promise<EvalResult> {
  const userId = await resetEvalUser();

  const seeded: { id: string; text: string }[] = [];
  for (const text of EVAL_ENTRIES) {
    const v = await embed(text);
    const [row] = await db
      .insert(entries)
      .values({ userId, text, type: "journal", embedding: v })
      .returning();
    seeded.push({ id: row.id, text });
  }

  // ── retrieval: hit@1 and hit@3 ──
  let hit1 = 0;
  let hit3 = 0;
  const retrievalDetails: { query: string; topHit: string; ok1: boolean; ok3: boolean }[] = [];
  for (const c of RETRIEVAL_CASES) {
    const qv = await embed(c.query);
    const top = await retrieveEntries(userId, qv, 3);
    const want = EVAL_ENTRIES[c.expected];
    const ok1 = top[0]?.text === want;
    const ok3 = top.slice(0, 3).some((t) => t.text === want);
    if (ok1) hit1++;
    if (ok3) hit3++;
    retrievalDetails.push({ query: c.query, topHit: (top[0]?.text ?? "").slice(0, 40), ok1, ok3 });
  }
  const retrieval1 = hit1 / RETRIEVAL_CASES.length;
  const retrieval3 = hit3 / RETRIEVAL_CASES.length;

  // ── extraction coverage ──
  const mira = seeded[1];
  const extracted = await extractMemories(userId, mira.id, mira.text);
  const blob = extracted.map((m) => m.content.toLowerCase()).join(" ");
  const covered = EXTRACTION_KEYWORDS.filter((k) => blob.includes(k));
  const extraction = covered.length / EXTRACTION_KEYWORDS.length;

  // ── dedup: same content twice → one row, recall_count incremented ──
  const dupContent = "EVAL-DEDUP-PROBE: the user is learning to bake sourdough bread at home.";
  await upsertMemory(userId, seeded[3].id, dupContent);
  await upsertMemory(userId, seeded[3].id, dupContent);
  const dch = hashOf(normalize(dupContent));
  const drows = (await db.execute(sql`
    SELECT count(*) AS c, max(recall_count) AS rc
    FROM memories WHERE user_id = ${userId} AND content_hash = ${dch}
  `)) as unknown as Record<string, unknown>[];
  const dedupCount = Number(drows[0]?.c ?? 0);
  const dedupRecall = Number(drows[0]?.rc ?? 0);
  const dedup = dedupCount === 1 && dedupRecall === 1;

  // ── groundedness: reflections invent no concrete facts (LLM judge) ──
  let grounded = 0;
  const groundDetails: { ok: boolean; verdict: string }[] = [];
  for (const e of GROUND_ENTRIES) {
    const r = await reflect(e); // no memories → only the entry as context
    const verdict = (
      await chat(
        [
          {
            role: "user",
            content: `Entry: "${e}"\n\nReflection: "${r}"\n\nDoes the reflection assert any specific concrete fact — a name, place, number, date, or event — that is NOT present in the entry? Answer with only "yes" or "no".`,
          },
        ],
        { temperature: 0, maxTokens: 4 },
      )
    )
      .trim()
      .toLowerCase();
    const ok = verdict.startsWith("no");
    if (ok) grounded++;
    groundDetails.push({ ok, verdict });
  }
  const groundedness = grounded / GROUND_ENTRIES.length;

  // ── reconcile (isolated so each probe's nearest neighbour is its own seed) ──
  // supersede: a move contradicts the prior city
  await db.delete(memoryHistory).where(eq(memoryHistory.userId, userId));
  await db.delete(memories).where(eq(memories.userId, userId));
  const supV = await embed("The user lives in Berlin.");
  await db.execute(sql`
    INSERT INTO memories (user_id, content, content_hash, type, status, embedding, confidence, importance)
    VALUES (${userId}, 'The user lives in Berlin.', 'eval-reconcile-sup', 'fact', 'active', ${toVectorLiteral(supV)}::vector, 0.7, 0.6)
  `);
  const [supEntry] = await db
    .insert(entries)
    .values({
      userId,
      text: "I moved to Lisbon last month, after years of living in Berlin.",
      type: "journal",
    })
    .returning();
  await extractMemories(userId, supEntry.id, supEntry.text);
  const supRows = (await db.execute(sql`
    SELECT status FROM memories WHERE user_id = ${userId} AND content_hash = 'eval-reconcile-sup'
  `)) as unknown as Record<string, unknown>[];
  const superseded = supRows[0]?.status === "superseded";

  // noop: a reworded restatement reinforces the existing memory instead of duplicating it
  await db.delete(memoryHistory).where(eq(memoryHistory.userId, userId));
  await db.delete(memories).where(eq(memories.userId, userId));
  const noopV = await embed("The user has a younger brother named Tomas.");
  await db.execute(sql`
    INSERT INTO memories (user_id, content, content_hash, type, status, embedding, confidence, importance, recall_count)
    VALUES (${userId}, 'The user has a younger brother named Tomas.', 'eval-reconcile-noop', 'relationship', 'active', ${toVectorLiteral(noopV)}::vector, 0.7, 0.6, 0)
  `);
  const [noopEntry] = await db
    .insert(entries)
    .values({ userId, text: "I called my younger brother Tomas this evening.", type: "journal" })
    .returning();
  await extractMemories(userId, noopEntry.id, noopEntry.text);
  const noopRows = (await db.execute(sql`
    SELECT recall_count FROM memories WHERE user_id = ${userId} AND content_hash = 'eval-reconcile-noop'
  `)) as unknown as Record<string, unknown>[];
  const noopReinforced = Number(noopRows[0]?.recall_count ?? 0) >= 1;
  const reconcile = superseded && noopReinforced;

  // ── recall-driven importance: retrieval bumps recall_count ──
  const recallProbe = "EVAL-RECALL-PROBE: the user collects vintage fountain pens.";
  const recallV = await embed(recallProbe);
  await db.execute(sql`
    INSERT INTO memories (user_id, content, content_hash, type, status, embedding, confidence, importance, recall_count)
    VALUES (${userId}, ${recallProbe}, ${hashOf(normalize(recallProbe))}, 'fact', 'active', ${toVectorLiteral(recallV)}::vector, 0.7, 0.6, 0)
  `);
  await retrieveMemories(userId, recallV, 3, "vintage fountain pens");
  await new Promise((r) => setTimeout(r, 1200)); // let the fire-and-forget bump land
  const recallRows = (await db.execute(sql`
    SELECT recall_count FROM memories
    WHERE user_id = ${userId} AND content_hash = ${hashOf(normalize(recallProbe))}
  `)) as unknown as Record<string, unknown>[];
  const recall = Number(recallRows[0]?.recall_count ?? 0) >= 1;

  // ── RRF hybrid: an exact keyword surfaces via the lexical arm ──
  const hybridProbe = "EVAL-HYBRID-PROBE: the user's cat is named Zlatan.";
  const hybridV = await embed(hybridProbe);
  await db.execute(sql`
    INSERT INTO memories (user_id, content, content_hash, type, status, embedding, confidence, importance)
    VALUES (${userId}, ${hybridProbe}, ${hashOf(normalize(hybridProbe))}, 'fact', 'active', ${toVectorLiteral(hybridV)}::vector, 0.7, 0.6)
  `);
  const hybridHits = await retrieveMemories(userId, await embed("Zlatan"), 5, "Zlatan");
  const hybrid = hybridHits.some((m) => m.content.includes("Zlatan"));

  // ── gates ──
  const gates = {
    retrieval1: retrieval1 >= 0.8,
    retrieval3: retrieval3 >= 0.8,
    extraction: extraction >= 0.8,
    dedup,
    groundedness: groundedness >= 0.5,
    reconcile,
    recall,
    hybrid,
  };
  const passed = Object.values(gates).every(Boolean);

  // persist each suite
  await db.insert(evalRuns).values([
    {
      suite: "retrieval",
      passed: gates.retrieval1 && gates.retrieval3,
      score: retrieval1,
      details: { retrieval1, retrieval3, cases: retrievalDetails },
    },
    {
      suite: "extraction-coverage",
      passed: gates.extraction,
      score: extraction,
      details: { extracted: extracted.map((m) => m.content), covered },
    },
    {
      suite: "dedup",
      passed: gates.dedup,
      score: dedup ? 1 : 0,
      details: { dedupCount, dedupRecall },
    },
    {
      suite: "groundedness",
      passed: gates.groundedness,
      score: groundedness,
      details: { groundDetails },
    },
    {
      suite: "reconcile",
      passed: gates.reconcile,
      score: reconcile ? 1 : 0,
      details: { superseded, noopReinforced },
    },
    {
      suite: "recall",
      passed: gates.recall,
      score: recall ? 1 : 0,
      details: { recallCount: Number(recallRows[0]?.recall_count ?? 0) },
    },
    {
      suite: "hybrid",
      passed: gates.hybrid,
      score: hybrid ? 1 : 0,
      details: { hits: hybridHits.map((m) => m.content.slice(0, 40)) },
    },
  ]);

  return {
    retrieval1,
    retrieval3,
    extraction,
    dedup,
    groundedness,
    reconcile,
    recall,
    hybrid,
    passed,
    details: { retrievalDetails, extracted: extracted.map((m) => m.content), groundDetails, gates },
  };
}
