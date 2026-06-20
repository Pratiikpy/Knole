import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { saveEntry, extractMemories, retrieveMemories } from "./engine";
import { embed } from "./embed";
import { reflect } from "./reflect";
import { askMyLife } from "./ask";

// Full multi-user flow, the way real users actually use it: three people live distinct
// journeys (with DELIBERATELY overlapping feelings — all get exhausted, all have doubts)
// through the exact journal pipeline (embed → recall → reflect → save → extract). We prove,
// per user, that the magic composes (a later entry recalls their OWN earlier memory and a
// grounded reflection comes back) AND that the privacy boundary holds end to end: one user's
// retrieval or "Ask My Life" never surfaces another user's data — even when probed with a
// query tuned to someone else's life. Throwaway users, created + deleted; demo untouched.
// On-demand: `npm run test:multiuser`.

const { users, entries, memories, memoryHistory, reflectionArtifacts } = schema;

// This run holds the DB connection across many ~15s LLM calls; Neon (serverless, PgBouncer)
// can drop an idle connection, so the next query ECONNRESETs. postgres.js reconnects for the
// NEXT query, so a bounded retry rides over transient resets (and a cold wake from idle-
// suspend can reset the first query too — hence the warm-up below).
async function retry<T>(fn: () => Promise<T>, max = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const s = `${(e as Error)?.message ?? e} ${(e as { cause?: { code?: string } })?.cause?.code ?? ""}`;
      if (
        !/ECONNRESET|ETIMEDOUT|TIMEOUT|terminat|onnection|fetch failed|socket|network/i.test(s) ||
        i >= max - 1
      )
        throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

type Persona = {
  tag: string;
  name: string;
  journey: string[];
  probe: string; // a "next day" entry that should recall their own earlier memories
  own: RegExp; // their distinctive themes
  proper: RegExp; // their distinctive proper nouns (for cross-user leak checks)
  ask: string;
};

const PERSONAS: Persona[] = [
  {
    tag: "mu-ava",
    name: "Ava",
    journey: [
      "Handed in my notice at the firm today — six years of spreadsheets. I'm going to train for the Chicago marathon instead. Terrifying.",
      "First long run, eight miles. My left knee twinged badly around mile six. Trying not to catastrophize but I'm worried about it.",
      "Exhausted but happy. The 5am starts are brutal, yet I haven't felt this alive in years.",
    ],
    probe:
      "The knee is acting up again on today's run — should I see a physio before it gets worse?",
    own: /knee|run|marathon|mile|physio|firm|spreadsheet/i,
    proper: /chicago|marathon/i,
    ask: "How has my body been holding up with the running?",
  },
  {
    tag: "mu-ben",
    name: "Ben",
    journey: [
      "We brought Theo home from the hospital today. Tiny and loud and ours. I'm terrified I'll get it all wrong.",
      "Third night with almost no sleep. I fell asleep mid-sentence on a client call. Exhausted doesn't cover it.",
      "Shipped the logo set for the bakery client despite running on fumes. A small win in the fog.",
    ],
    probe: "Theo finally slept four hours straight last night and I cried a little from relief.",
    own: /theo|sleep|baby|hospital|client|logo|bakery/i,
    proper: /theo|bakery/i,
    ask: "How am I coping since the baby arrived?",
  },
  {
    tag: "mu-cara",
    name: "Cara",
    journey: [
      "Signed up for weekly piano lessons — always wanted to, never made the time. Day one: I can just about play a C scale.",
      "Three weeks until I see Daniel again. The distance is the hardest part; some nights I just stare at the ceiling.",
      "Nailed the first half of the Moonlight Sonata tonight. My piano teacher actually smiled.",
    ],
    probe:
      "Practiced piano for two hours tonight, partly to keep my mind off how much I miss Daniel.",
    own: /piano|sonata|scale|daniel|lesson|teacher/i,
    proper: /daniel|moonlight/i,
    ask: "What have I been pouring my energy into lately?",
  },
];

// One entry through the real journalFn pipeline. extractMemories is awaited here (in the app
// it's backgrounded) so the memory is durable before the next entry's recall — same effect,
// made deterministic for the test.
async function journal(uid: string, text: string) {
  const qVec = await embed(text);
  const recalled = await retrieveMemories(uid, qVec, 6, text);
  const reflection = await reflect(
    text,
    recalled.map((m) => ({ content: m.content, sourceQuote: m.sourceQuote })),
  );
  const entry = await saveEntry(uid, text, qVec);
  const extracted = await extractMemories(uid, entry.id, text);
  return { reflection, extracted };
}

async function wipe(uid: string) {
  await db.delete(memoryHistory).where(eq(memoryHistory.userId, uid));
  await db.delete(reflectionArtifacts).where(eq(reflectionArtifacts.userId, uid));
  await db.delete(memories).where(eq(memories.userId, uid));
  await db.delete(entries).where(eq(entries.userId, uid));
}

// warm the connection (cold wake from idle-suspend can reset the first query)
await retry(() => db.execute(sql`SELECT 1`));

// ── setup: three real, isolated users ──
const ids: Record<string, string> = {};
for (const p of PERSONAS) {
  let [u] = await retry(() =>
    db.select({ id: users.id }).from(users).where(eq(users.privyId, p.tag)).limit(1),
  );
  if (!u)
    [u] = await retry(() =>
      db
        .insert(users)
        .values({ privyId: p.tag, email: `${p.tag}@knole.local` })
        .returning({ id: users.id }),
    );
  ids[p.tag] = u.id;
  await retry(() => wipe(u.id));
}

// ── each user lives their journey through the real pipeline ──
type R = {
  mems: number;
  reflectionsOk: boolean;
  recalledOwn: boolean;
  recallSample: string;
  ask: { summary: string; receipts: number };
  askText: string; // summary + receipt quotes, lowercased — for cross-user leak checks
};
const res: Record<string, R> = {};
for (const p of PERSONAS) {
  const uid = ids[p.tag];
  let mems = 0;
  let reflectionsOk = true;
  for (const text of p.journey) {
    const { extracted, reflection } = await retry(() => journal(uid, text));
    mems += extracted.length;
    if (reflection.trim().length < 40) reflectionsOk = false;
  }
  // the magic: a later entry recalls their OWN earlier memory
  const pVec = await embed(p.probe);
  const recalled = await retry(() => retrieveMemories(uid, pVec, 6, p.probe));
  const recalledOwn = recalled.some((m) => p.own.test(m.content));
  // Ask My Life — answer + receipts, drawn only from their own words
  const ask = await retry(() => askMyLife(uid, p.ask));
  res[p.tag] = {
    mems,
    reflectionsOk,
    recalledOwn,
    recallSample: recalled[0]?.content.slice(0, 64) ?? "(none)",
    ask: { summary: ask.summary, receipts: ask.receipts.length },
    askText: (ask.summary + " " + ask.receipts.map((r) => r.quote).join(" ")).toLowerCase(),
  };
}

// ── isolation: probe every user with EVERY OTHER user's life and confirm nothing crosses ──
let retrievalLeaks = 0;
let askLeaks = 0;
const leakDetail: string[] = [];
for (const p of PERSONAS) {
  const uid = ids[p.tag];
  const others = PERSONAS.filter((o) => o.tag !== p.tag);
  // (a) retrieval: a query tuned to another user's life must not surface that user's memories
  for (const o of others) {
    const fVec = await embed(o.probe);
    const got = await retry(() => retrieveMemories(uid, fVec, 6, o.probe));
    const foreign = got.filter(
      (m) => o.proper.test(m.content) || (o.own.test(m.content) && !p.own.test(m.content)),
    );
    if (foreign.length) {
      retrievalLeaks += foreign.length;
      leakDetail.push(
        `${p.name}'s retrieval surfaced ${o.name}: "${foreign[0].content.slice(0, 40)}"`,
      );
    }
  }
  // (b) ask: this user's answer + receipts must not contain another user's proper nouns
  const askText = res[p.tag].askText;
  for (const o of others) {
    if (o.proper.test(askText)) {
      askLeaks++;
      leakDetail.push(`${p.name}'s ask leaked ${o.name}'s proper noun`);
    }
  }
}

// ── proof ──
console.log("\n=== MULTI-USER FLOW (3 isolated users, full journeys) ===\n");
let allMagic = true;
for (const p of PERSONAS) {
  const r = res[p.tag];
  const magic = r.mems > 0 && r.recalledOwn && r.reflectionsOk;
  allMagic = allMagic && magic;
  console.log(`${p.name}:`);
  console.log(`  memories formed     : ${r.mems}`);
  console.log(`  reflections grounded: ${r.reflectionsOk}`);
  console.log(`  recalled own memory : ${r.recalledOwn}  ("${r.recallSample}…")`);
  console.log(`  ask → receipts      : ${r.ask.receipts}  "${r.ask.summary.slice(0, 70)}…"`);
  console.log(`  ${magic ? "✓ magic works" : "✗ magic broke"}\n`);
}
console.log(`isolation — retrieval leaks: ${retrievalLeaks}, ask leaks: ${askLeaks}`);
for (const d of leakDetail) console.log(`   ⚠ ${d}`);

// ── cleanup ──
for (const p of PERSONAS) {
  const uid = ids[p.tag];
  await retry(() => wipe(uid));
  await retry(() => db.delete(users).where(eq(users.id, uid)));
}

const ok = allMagic && retrievalLeaks === 0 && askLeaks === 0;
console.log(
  "\n" +
    (ok
      ? "✅ MULTI-USER: every user's magic composes; no retrieval or ask ever crosses the user boundary"
      : "❌ FAIL: see above"),
);
process.exit(ok ? 0 : 1);
