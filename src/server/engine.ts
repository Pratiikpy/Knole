import { createHash, randomUUID } from "node:crypto";
import { sql, eq, and, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { embed, toVectorLiteral } from "./embed";
import { chatPrivate } from "./sealed";
import { putData } from "./og";
import { keyProvider } from "./keyProvider";
import { upsertEntities, matchEntities, entityBoostWeight } from "./entities";
import { recordJournaledDayBg } from "./dayAnchor";
import { extractEntityEdges } from "./entityEdges";
import { indexEntryDates, entryDateGate, type DateRange } from "./dateLens";
import { background } from "./background";

const { users, entries, replies, memories, memoryHistory } = schema;

const VALID_TYPES = new Set([
  "fact",
  "pattern",
  "commitment",
  "relationship",
  "preference",
  "value",
  "emotion",
]);

// ── demo user (until Privy auth lands) ───────────────────
let demoUserIdP: Promise<string> | null = null;
export function getDemoUserId(): Promise<string> {
  if (!demoUserIdP) {
    // The read-only showcase user. Configurable (defaults to "demo") so local write-flow
    // testing can point at a throwaway user instead of mutating the real demo.
    const privyId = process.env.DEMO_PRIVY_ID ?? "demo";
    demoUserIdP = (async () => {
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.privyId, privyId))
        .limit(1);
      if (found[0]) return found[0].id;
      const ins = await db
        .insert(users)
        .values({ privyId, email: `${privyId}@knole.local` })
        .returning({ id: users.id });
      return ins[0].id;
    })().catch((e) => {
      demoUserIdP = null; // a transient DB error must not poison this for the whole instance
      throw e;
    });
  }
  return demoUserIdP;
}

// A per-browser anonymous user — the private, no-signup journal. Each browser gets its own (remembered
// in the sealed session cookie), so no two visitors ever share a journal — the whole point of a
// private product. Starter credits let a guest try the metered surfaces (research, image) before
// signing in; the free daily practice (write, reflect, mirror, ask, chat) never costs a credit.
export async function createGuestUser(): Promise<string> {
  const ins = await db
    .insert(users)
    .values({ privyId: `guest-${randomUUID()}`, credits: 40 })
    .returning({ id: users.id });
  return ins[0].id;
}

// ── save an entry (+ local embedding) ────────────────────
export async function saveEntry(
  userId: string,
  text: string,
  vec?: number[],
  type: "journal" | "chat" | "saved" = "journal",
  meta?: {
    title?: string | null;
    tags?: string[] | null;
    mood?: string | null;
    valence?: number | null;
    valenceLabel?: string | null;
    energy?: number | null;
    moodRel?: string | null;
    sections?: Record<string, string> | null;
    // Backfill: the yesterday capture slot writes an entry dated to yesterday evening in the
    // user's timezone, so the timeline, mood graph, and nudge suppression all read it correctly.
    createdAt?: Date;
  },
) {
  // Date-prefixed embedding (freenote): the stored vector carries the entry's human-readable date
  // ("Saturday, 15 August 2026") so time-referencing queries ("what happened in March") actually
  // land. The caller's vec (raw-text embedding) still serves ITS retrieval; storage gets the dated
  // one. Re-embedding is local MiniLM - microseconds, not a network call.
  const when = meta?.createdAt ?? new Date();
  const dateLine = when.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const v = await embed(`${dateLine}
${text}`).catch(async () => vec ?? (await embed(text)));
  const [row] = await db
    .insert(entries)
    .values({
      userId,
      text,
      type,
      embedding: v,
      title: meta?.title ?? null,
      tags: meta?.tags ?? null,
      // The quick check-in carries a user-SELECTED mood/valence (no LLM scoring needed) so the mood
      // graph + trend are accurate from a one-tap entry.
      mood: meta?.mood ?? null,
      valence: meta?.valence ?? null,
      valenceLabel: meta?.valenceLabel ?? null,
      energy: meta?.energy ?? null,
      moodRel: meta?.moodRel ?? null,
      sections: meta?.sections ?? null,
      ...(meta?.createdAt ? { createdAt: meta.createdAt } : {}),
    })
    .returning();
  // Proof-of-journaling, recorded HERE rather than in one caller. KnoleCommitment settles real
  // staked money against this on-chain count, and it was only being written on the streaming
  // reflection path - so a user who journaled every day through the quick check-in, the composer,
  // post-session capture, the extension or onboarding could still forfeit their stake. Idempotent
  // per UTC day, skips guests, and never counts clipped/imported material as journaling.
  if (type === "journal") recordJournaledDayBg(userId);
  // The date lens: dates this entry MENTIONS become searchable ("what did I write about my
  // birthday" matches the entry that talks about it). Chat turns are skipped - conversational
  // date mentions are noise, not events.
  if (type !== "chat") {
    background(indexEntryDates(userId, row.id, text, when), "indexEntryDates");
  }
  return row;
}

export async function saveReply(entryId: string, text: string, isAi = true) {
  const [row] = await db.insert(replies).values({ parentEntryId: entryId, text, isAi }).returning();
  return row;
}

// ── retrieve relevant memories (pgvector cosine) ─────────
export type Recalled = {
  id: string;
  content: string;
  sourceQuote: string | null;
  createdAt: string | null;
  score: number;
};

// Postgres full-text stopwords do the heavy lifting inside to_tsvector; this only has to stop
// tsquery syntax characters from reaching the parser and cap how many terms we OR together.
// One arm's top-rank contribution in the RRF fusion below (k = 60).
const RRF_UNIT = 1 / 61;

const LEX_STOP = new Set(
  (
    "the a an and or but if then than that this these those i you he she it we they me my your his " +
    "her its our their of to in on at for with from by as is are was were be been being do does " +
    "did have has had not no so just about into over under again very can will would should could " +
    "what when where who whom which how why all any both each few more most other some such only " +
    "own same too s t don now"
  ).split(" "),
);

/** Turn free text into an OR tsquery of its most distinctive terms (empty string if none). */
export function toOrTsQuery(text: string, max = 12): string {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || LEX_STOP.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    terms.push(raw);
    if (terms.length >= max) break;
  }
  return terms.join(" | ");
}

export async function retrieveMemories(
  userId: string,
  queryVec: number[],
  k = 6,
  queryText?: string,
): Promise<Recalled[]> {
  const lit = toVectorLiteral(queryVec);
  // plainto_tsquery ANDs EVERY word of its input, and the caller passes whole journal entries -
  // so the lexical arm required one memory to contain every content word of the entry and matched
  // nothing at all in practice (measured: adding 8 unrelated words to a query that matched took it
  // from 1 hit to 0). The hybrid was paying for a full tsvector scan and getting pure vector back.
  // Distinctive terms, OR'd, ranked by ts_rank: that is what the fusion was always meant to fuse.
  const lexQuery = toOrTsQuery(queryText ?? "");
  const useHybrid = !!queryText && queryText.trim().length > 0 && lexQuery.length > 0;
  // RRF hybrid: fuse vector (semantic) + lexical (exact keyword) rankings so exact
  // names/terms the embedding underweights still surface. Pure vector otherwise.
  const rows = useHybrid
    ? await db.execute(sql`
        WITH vec AS (
          SELECT id, content, source_quote, created_at,
                 row_number() OVER (ORDER BY embedding <=> ${lit}::vector) AS rnk
          FROM memories
          WHERE user_id = ${userId} AND status IN ('active', 'pinned') AND embedding IS NOT NULL
          ORDER BY embedding <=> ${lit}::vector LIMIT 40
        ),
        lex AS (
          SELECT id, content, source_quote, created_at,
                 row_number() OVER (
                   ORDER BY ts_rank(to_tsvector('english', content), to_tsquery('english', ${lexQuery})) DESC
                 ) AS rnk
          FROM memories
          WHERE user_id = ${userId} AND status IN ('active', 'pinned')
            AND to_tsvector('english', content) @@ to_tsquery('english', ${lexQuery})
          ORDER BY ts_rank(to_tsvector('english', content), to_tsquery('english', ${lexQuery})) DESC
          LIMIT 40
        )
        SELECT COALESCE(vec.id, lex.id) AS id,
               COALESCE(vec.content, lex.content) AS content,
               COALESCE(vec.source_quote, lex.source_quote) AS source_quote,
               COALESCE(vec.created_at, lex.created_at) AS created_at,
               COALESCE(1.0 / (60 + vec.rnk), 0) + COALESCE(1.0 / (60 + lex.rnk), 0) AS score
        FROM vec FULL OUTER JOIN lex ON vec.id = lex.id
        ORDER BY score DESC
        LIMIT ${k}
      `)
    : await db.execute(sql`
        SELECT id, content, source_quote, created_at,
               1 - (embedding <=> ${lit}::vector) AS score
        FROM memories
        WHERE user_id = ${userId} AND status IN ('active', 'pinned') AND embedding IS NOT NULL
        ORDER BY embedding <=> ${lit}::vector
        LIMIT ${k}
      `);
  const result = (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    content: String(r.content),
    sourceQuote: r.source_quote == null ? null : String(r.source_quote),
    createdAt: r.created_at == null ? null : String(r.created_at),
    score: Number(r.score),
  }));

  // Entity arm (mem0): when the query resembles a stored entity ("how's Mara?"), that entity's
  // memories get a crowd-damped boost - and its strongest links join the candidate set even if
  // the semantic/lexical arms missed them. Damping keeps broad entities from dominating.
  try {
    const ents = await matchEntities(userId, queryVec, 3);
    if (ents.length) {
      const byId = new Map(result.map((r) => [r.id, r]));
      const pullIds: string[] = [];
      for (const ent of ents) {
        // RRF scores top out around 1/61 + 1/61 = 0.033, while the raw boost reaches 0.5 - roughly
        // 15x larger, so ANY entity match used to override the fused ranking entirely and the
        // fusion this function is built around was dead whenever the entity arm fired. Scaled so a
        // perfect entity match is worth at most what being #1 in one arm is worth.
        const w = entityBoostWeight(ent.sim, ent.memoryIds.length) * 2 * RRF_UNIT;
        for (const mid of ent.memoryIds) {
          const hit = byId.get(mid);
          if (hit) hit.score += w;
          else if (pullIds.length < 6) pullIds.push(mid);
        }
      }
      if (pullIds.length) {
        const pulled = (await db.execute(sql`
          SELECT id, content, source_quote, created_at FROM memories
          WHERE user_id = ${userId} AND id = ANY(${pullIds}::uuid[]) AND status IN ('active', 'pinned')
        `)) as unknown as Record<string, unknown>[];
        for (const r of pulled) {
          const ent = ents.find((e) => e.memoryIds.includes(String(r.id)));
          if (!ent) continue;
          result.push({
            id: String(r.id),
            content: String(r.content),
            sourceQuote: r.source_quote == null ? null : String(r.source_quote),
            createdAt: r.created_at == null ? null : String(r.created_at),
            score: entityBoostWeight(ent.sim, ent.memoryIds.length) * 2 * RRF_UNIT,
          });
        }
      }
      result.sort((a, b) => b.score - a.score);
      result.splice(k);
    }
  } catch {
    /* the entity arm is an enhancement - the fused base ranking stands */
  }

  // recall-driven importance (OpenClaw): a memory earns importance by being recalled.
  if (result.length)
    void bumpRecall(
      userId,
      result.map((r) => r.id),
    ).catch((e) =>
      console.error("bumpRecall failed (recall-importance ranking stalls):", (e as Error).message),
    );
  return result;
}

/** What the extractor filed from one entry - the filing strip's data (memex placeholder flow). */
export async function memoriesForEntry(
  userId: string,
  entryId: string,
): Promise<{ id: string; type: string; content: string }[]> {
  const rows = await db
    .select({ id: memories.id, type: memories.type, content: memories.content })
    .from(memories)
    .where(and(eq(memories.sourceEntryId, entryId), eq(memories.userId, userId)))
    .limit(8);
  return rows.map((r) => ({ id: r.id, type: String(r.type), content: r.content }));
}

/** Bump recall stats for memories that were just surfaced (fire-and-forget). */
export async function bumpRecall(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.execute(sql`
    UPDATE memories SET
      recall_count = recall_count + 1,
      distinct_day_count = distinct_day_count + (
        CASE WHEN last_recalled_at IS NULL
               OR date_trunc('day', last_recalled_at) < date_trunc('day', now())
          THEN 1 ELSE 0 END
      ),
      last_recalled_at = now(),
      importance = LEAST(1.0, COALESCE(importance, 0.5) + 0.02),
      updated_at = now()
    WHERE user_id = ${userId} AND id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
}

// ── retrieve relevant raw entries (for Ask My Life receipts) ──
export type EntryHit = { id: string; text: string; createdAt: string; score: number };

export async function retrieveEntries(
  userId: string,
  queryVec: number[],
  k = 5,
  dateRange?: DateRange | null,
): Promise<EntryHit[]> {
  const lit = toVectorLiteral(queryVec);
  // The date lens gate: when the query carried a dt-filter, entries must be written in - or
  // mention a date in - the range, BEFORE vector ranking. Empty gate otherwise.
  const gate = dateRange ? entryDateGate(dateRange) : sql``;
  const rows = await db.execute(sql`
    SELECT id, text, created_at, 1 - (embedding <=> ${lit}::vector) AS score
    FROM entries
    WHERE user_id = ${userId} AND embedding IS NOT NULL AND deleted_at IS NULL
      AND type <> 'chat'
      ${gate}
    ORDER BY embedding <=> ${lit}::vector
    LIMIT ${k}
  `);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    text: String(r.text),
    createdAt: String(r.created_at),
    score: Number(r.score),
  }));
}

// ── extract durable memories from an entry (+ dedup) ─────
// The extraction prompt - upgraded with mem0 V3's rules (their prompts.py, adapted to a journal):
// observation-date grounding (relative dates resolve against the ENTRY's date, not today's),
// the capture-the-transition rule, self-contained 15-80-word memories, an exhaustive checklist,
// and linking to existing memories via small int handles (never raw ids - anti-hallucination).
const EXTRACT_SYS = `Extract durable, useful long-term memories about the user from their journal entry. Only keep things worth remembering across future sessions. Ignore fleeting detail.

DATES: The entry was written on the date given as ENTRY DATE. Resolve every relative reference against THAT date, never today's - "yesterday" in an entry dated 2026-03-10 means 2026-03-09. When a memory involves time, state the absolute date or month in the content ("In March 2026 you...").

TRANSITIONS: When the entry reveals a CHANGE - a job left, a move, a relationship shift, a habit started or abandoned, a decision reversed - capture the transition itself as its own memory ("You left the startup in August 2026 after two years"), not merely the new state. The change carries the story.

CONTENT: Write each memory in the second person - "You..." / "Your..." - never "the user" or "they". Make it self-contained and contextual: 15-80 words carrying enough who/what/when that it stands alone months later. A bare fragment ("likes coffee") is worthless; a situated fact ("You switched to decaf in mid-2026 because afternoon coffee was wrecking your sleep") is a memory.

CHECKLIST - sweep ALL of these before finishing: facts about their life and circumstances / people and relationships (names, roles, how they matter) / goals and commitments (with deadlines when given) / recurring feelings or patterns / preferences and habits / values and beliefs / transitions and changes / health and wellbeing signals.

LINKING: You may be given EXISTING MEMORIES as a numbered list. When a new memory continues, updates, or relates to one of them (same person, same project, a change from that state), include the numbers in "linked". Use ONLY numbers from the list. Omit or use [] when nothing relates.

ENTITIES: For each memory, also list the distinct named entities it mentions - people, places, organizations, named projects. Proper names only ("Mara", "Meridian Labs"), never generic words ("work", "the gym", "my sister" without a name). [] when none.

Return a JSON array; each item: {"content": "<self-contained memory, second person, 15-80 words>", "type": "fact|pattern|commitment|relationship|preference|value|emotion", "quote": "<short verbatim quote from the entry supporting it>", "confidence": <0.0-1.0 - ~0.9 stated plainly, ~0.6 fair inference, ~0.4 tentative read>, "linked": [<numbers of related EXISTING MEMORIES, or []>], "entities": ["<proper names mentioned, or []>"]}.
Return [] if nothing durable. Output ONLY the JSON array, no prose.`;

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

const RECONCILE_SYS = `You compare an OLD and a NEW fact about the same person. Reply with exactly ONE word:
"update" — the NEW replaces the OLD (they cannot both be currently true: a change of location, job, status, relationship, or preference);
"duplicate" — they state the SAME fact with no new information (just reworded);
"independent" — both can be true at once as distinct facts.`;

async function judgeMemory(
  oldContent: string,
  newContent: string,
): Promise<"update" | "duplicate" | "independent"> {
  // chatPrivate: anonymised before the model AND TEE-first with plain-0G fallback — the reconcile
  // judge sees no real names and survives a router-balance outage.
  const r = (
    await chatPrivate(
      [
        { role: "system", content: RECONCILE_SYS },
        { role: "user", content: `OLD: ${oldContent}\nNEW: ${newContent}` },
      ],
      { temperature: 0, maxTokens: 4 },
    )
  ).content
    .trim()
    .toLowerCase();
  if (r.startsWith("update")) return "update";
  if (r.startsWith("duplicate")) return "duplicate";
  return "independent";
}

export async function extractMemories(userId: string, entryId: string, entryText: string) {
  // Observation-date grounding: relative dates in the entry resolve against the entry's own date
  // (a backfilled entry keeps its day), so "yesterday" never silently means "yesterday at extract
  // time". Linking context: the most similar existing memories ride along as INT handles - the
  // model links by small number, we map back to UUIDs (mem0's anti-hallucination remap).
  const [entryRow] = await db
    .select({ createdAt: entries.createdAt })
    .from(entries)
    .where(eq(entries.id, entryId));
  const entryDate = (entryRow?.createdAt ?? new Date()).toISOString().slice(0, 10);
  let linkCandidates: { id: string; content: string }[] = [];
  try {
    const qv = toVectorLiteral(await embed(entryText.slice(0, 1000)));
    const cand = (await db.execute(sql`
      SELECT id, content FROM memories
      WHERE user_id = ${userId} AND status IN ('active', 'pinned') AND embedding IS NOT NULL
      ORDER BY embedding <=> ${qv}::vector LIMIT 8
    `)) as unknown as Record<string, unknown>[];
    linkCandidates = cand.map((r) => ({ id: String(r.id), content: String(r.content) }));
  } catch {
    /* linking is an enhancement - extraction proceeds without it */
  }
  const contextBlock = linkCandidates.length
    ? `\n\nEXISTING MEMORIES:\n${linkCandidates.map((c, i) => `${i + 1}. ${c.content}`).join("\n")}`
    : "";

  // chatPrivate scrubs names before the model sees the entry and restores them in the reply, so
  // extracted memories keep real names while the model only ever saw placeholders - and the call
  // rides the funded TEE broker first instead of dying with the router balance.
  const raw = (
    await chatPrivate(
      [
        { role: "system", content: EXTRACT_SYS },
        {
          role: "user",
          content: `ENTRY DATE: ${entryDate}\n\nENTRY:\n${entryText}${contextBlock}`,
        },
      ],
      { temperature: 0.2, maxTokens: 1000 },
    )
  ).content;

  let items: {
    content?: string;
    type?: string;
    quote?: string;
    confidence?: number;
    linked?: number[];
    entities?: string[];
  }[] = [];
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    // No array at all (model wrapped/refused) is a real extraction miss — surface it, don't vanish.
    if (!m) console.error("extractMemories: no JSON array in LLM output:", raw.slice(0, 200));
    items = m ? JSON.parse(m[0]) : [];
  } catch (e) {
    console.error(
      "extractMemories: unparseable JSON from LLM:",
      (e as Error).message,
      raw.slice(0, 200),
    );
    items = [];
  }

  const saved: { id: string; content: string }[] = [];
  for (const it of items) {
    if (!it?.content) continue;
    // Enforce the 15-80-word memory rule in CODE, not just the prompt (letta teardown finding):
    // a runaway generation must not become a permanent, retrieval-polluting wall of text, and a
    // fragment is not a memory. Overlong content is clipped at a sentence edge, tiny is dropped.
    {
      const words = it.content.trim().split(/\s+/);
      if (words.length < 4) continue;
      if (words.length > 110) {
        const clipped = words.slice(0, 100).join(" ");
        const lastStop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "));
        it.content = lastStop > 60 ? clipped.slice(0, lastStop + 1) : clipped;
      }
    }
    try {
      const type = it.type && VALID_TYPES.has(it.type) ? it.type : "fact";
      // How sure the model is this memory is true + durable. Clamp to a sane floor so a missing/garbage
      // value still lands at the old default. Earned higher later by recall + a user edit.
      const conf = Math.max(0.3, Math.min(1, Number(it.confidence) || 0.7));
      const ch = hash(normalize(it.content));
      const v = await embed(it.content);
      const vlit = toVectorLiteral(v);

      // reconcile against the TOP THREE neighbours, not just the nearest (graphiti's
      // multi-candidate resolve): a contradiction with the second-most-similar memory used to be
      // missed entirely. The first "duplicate" verdict short-circuits; judge calls stay bounded
      // because only candidates above the similarity bar are consulted at all.
      const sims = (await db.execute(sql`
      SELECT id, content, status, user_verified_at, 1 - (embedding <=> ${vlit}::vector) AS score
      FROM memories
      WHERE user_id = ${userId} AND status IN ('active', 'pinned')
        AND content_hash <> ${ch} AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vlit}::vector
      LIMIT 3
    `)) as unknown as Record<string, unknown>[];
      let supersededId: string | null = null;
      let reinforced = false;
      for (const cand of sims) {
        if (Number(cand.score) < 0.45) break; // ordered by similarity - nothing further qualifies
        const verdict = await judgeMemory(String(cand.content), it.content);
        if (verdict === "duplicate") {
          // NOOP: reinforce the existing memory instead of storing a near-duplicate
          await db.execute(sql`
          UPDATE memories SET recall_count = recall_count + 1, updated_at = now()
          WHERE id = ${String(cand.id)} AND user_id = ${userId}
        `);
          saved.push({ id: String(cand.id), content: String(cand.content) });
          reinforced = true;
          break;
        }
        // update: supersede the prior memory — but never one the user controls. A pin
        // (pinned-survival) or a hand-edit (user_verified_at, the user-edit-wins lock) outranks
        // the engine's inference; the new memory is added alongside it, for the user to reconcile.
        const userControlled = String(cand.status) === "pinned" || cand.user_verified_at != null;
        if (verdict === "update" && !userControlled && !supersededId) {
          supersededId = String(cand.id);
        }
      }
      if (reinforced) continue;

      // content-hash UPSERT dedup (memori): reinforce on conflict instead of duplicating
      // Map the model's int handles back to real memory ids (only in-range handles survive).
      const linkedIds = Array.isArray(it.linked)
        ? Array.from(
            new Set(
              it.linked
                .map((n) => linkCandidates[Number(n) - 1]?.id)
                .filter((id): id is string => !!id),
            ),
          )
        : [];
      const linkedJson = linkedIds.length ? JSON.stringify(linkedIds) : null;
      const res = await db.execute(sql`
      INSERT INTO memories
        (user_id, content, content_hash, type, status, source_entry_id, source_quote, embedding, confidence, importance, linked_ids)
      VALUES
        (${userId}, ${it.content}, ${ch}, ${type}, 'active', ${entryId}, ${it.quote ?? null}, ${vlit}::vector, ${conf}, 0.6, ${linkedJson}::jsonb)
      ON CONFLICT (user_id, content_hash)
        DO UPDATE SET recall_count = memories.recall_count + 1, updated_at = now()
      RETURNING id, content
    `);
      const row = (res as unknown as Record<string, unknown>[])[0];
      const newId = row ? String(row.id) : null;

      // supersede-not-delete: keep the old memory, mark it invalid (bi-temporal)
      if (supersededId && newId && supersededId !== newId) {
        await db.execute(sql`
        UPDATE memories SET status = 'superseded', invalid_at = now(), invalidated_by = ${newId}, updated_at = now()
        WHERE id = ${supersededId} AND user_id = ${userId}
      `);
        await logHistory(supersededId, userId, "superseded", null, { by: newId });
      }
      if (row) {
        saved.push({ id: String(row.id), content: String(row.content) });
        // Entity store (mem0): record proper names this memory mentions - the third retrieval arm.
        if (Array.isArray(it.entities) && it.entities.length) {
          await upsertEntities(
            userId,
            String(row.id),
            it.entities.filter((e): e is string => typeof e === "string").slice(0, 6),
          ).catch(() => {});
        }
      }
    } catch (e) {
      // One item's reconcile call or embed timing out must not discard the memories after it.
      // Extraction runs in the background, so an escaping throw silently lost the rest of the
      // entry's memories with nothing surfaced to the user.
      console.error("extractMemories: item failed, continuing:", (e as Error).message);
    }
  }
  // Relationship edges (graphiti): one extra focused call, only when the entry actually named
  // people/places - most entries skip it. Failures never disturb the saved memories.
  const namedAny = items.some((it) => Array.isArray(it?.entities) && it.entities.length > 0);
  if (namedAny) {
    try {
      await extractEntityEdges(
        userId,
        saved[0]?.id ?? null,
        entryText,
        entryRow?.createdAt ?? new Date(),
      );
    } catch (e) {
      console.error("entity-edge extraction failed:", (e as Error).message);
    }
  }
  return saved;
}

// ── 0G Storage: encrypt + store each entry under a per-user key ──
// The per-user AES-256 key, at the current key version. Custody (env vs KMS) and rotation live in
// keyProvider.ts; v1's derivation is unchanged, so every existing 0G blob still decrypts.
export function keyForUser(userId: string): Uint8Array {
  return keyProvider.deriveUserKey(userId);
}

/**
 * Every candidate decryption key for a user, newest key version first. Decryption walks these and
 * the GCM auth tag picks the right one — so data written under a since-rotated key still reads.
 */
export function userKeyCandidates(userId: string): Uint8Array[] {
  return keyProvider.userKeyCandidates(userId);
}

/** Stamp the first Mirror reveal (no-op if already stamped) — gates the one-time reveal ceremony. */
export async function markMirrorRevealed(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ mirrorRevealedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.mirrorRevealedAt)));
}

/**
 * The stable "who you are becoming" identity portrait — a deterministic, embedding-free pull of the
 * durable identity memories (values, commitments, patterns, relationships, preferences), ranked by
 * earned importance + recall. Powers the Future-Self persona; constant across a conversation's turns.
 */
export async function retrieveIdentityMemories(
  userId: string,
  k = 10,
): Promise<{ id: string; content: string; type: string; sourceQuote: string | null }[]> {
  const rows = (await db.execute(sql`
    SELECT id, content, type, source_quote
    FROM memories
    WHERE user_id = ${userId}
      AND status IN ('active', 'pinned')
      AND type IN ('value', 'commitment', 'pattern', 'relationship', 'preference')
    ORDER BY importance DESC NULLS LAST, recall_count DESC, created_at DESC
    LIMIT ${k}
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    content: String(r.content),
    type: String(r.type),
    sourceQuote: r.source_quote ? String(r.source_quote) : null,
  }));
}

/** Counts that gate the Future-Self simulation — a thin Index can't ground an honest future self. */
export async function futureSelfReadiness(
  userId: string,
): Promise<{ memoryCount: number; entryCount: number }> {
  const mRows = (await db.execute(sql`
    SELECT count(*) AS c FROM memories
    WHERE user_id = ${userId}
      AND status IN ('active', 'pinned')
      AND type IN ('value', 'commitment', 'pattern', 'relationship', 'preference')
  `)) as unknown as Record<string, unknown>[];
  const eRows = (await db.execute(sql`
    SELECT count(*) AS c FROM entries WHERE user_id = ${userId}
  `)) as unknown as Record<string, unknown>[];
  return {
    memoryCount: Number(mRows[0]?.c ?? 0),
    entryCount: Number(eRows[0]?.c ?? 0),
  };
}

export async function storeEntryOn0G(
  userId: string,
  entryId: string,
  text: string,
): Promise<string> {
  // The gate lives HERE, not in the callers. Only the streaming save path used to check, while ten
  // other call sites (chat compose, quick check-in, import, onboarding, the nightly backfill) wrote
  // a SERVER-readable copy for users who had enrolled in client-side encryption - the one thing
  // that enrollment promises can never happen. A missed caller is a broken promise, so it is
  // enforced at the single point that does the writing.
  const [row] = await db
    .select({
      clientEnc: users.clientEncEnabled,
      deletedAt: entries.deletedAt,
      kvRef: entries.kvRef,
    })
    .from(entries)
    .innerJoin(users, eq(users.id, entries.userId))
    .where(eq(entries.id, entryId));
  if (!row) return "";
  if (row.clientEnc) return ""; // the client sweep owns this entry; the server must not read it
  // 0G storage is permanent. An entry the user has deleted must never be published to it, and a
  // re-upload of an already-stored entry is pure waste.
  if (row.deletedAt) return "";
  if (row.kvRef) return row.kvRef;

  const key = keyForUser(userId);
  const payload = JSON.stringify({ entryId, text, savedAt: new Date().toISOString() });
  const { rootHash } = await putData(payload, { key });
  // Only claim the row if it is STILL eligible — the user may have enrolled or deleted while the
  // upload was in flight, and the client sweep may have written its own copy.
  await db
    .update(entries)
    .set({ kvRef: rootHash, encScheme: "server" })
    .where(and(eq(entries.id, entryId), isNull(entries.kvRef), isNull(entries.deletedAt)));
  return rootHash;
}

// ── memory dashboard: list / pin / forget / edit ─────────
export type MemoryRow = {
  id: string;
  content: string;
  type: string;
  status: string;
  sourceQuote: string | null;
  recallCount: number;
  confidence: number;
  createdAt: string;
  kvRef: string | null;
};

export async function listMemories(userId: string): Promise<MemoryRow[]> {
  const rows = await db.execute(sql`
    SELECT m.id, m.content, m.type, m.status, m.source_quote, m.recall_count, m.confidence,
           m.created_at, e.kv_ref
    FROM memories m
    LEFT JOIN entries e ON e.id = m.source_entry_id
    WHERE m.user_id = ${userId} AND m.status NOT IN ('forgotten', 'superseded', 'rejected')
    ORDER BY (m.status = 'pinned') DESC, m.created_at DESC
  `);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    content: String(r.content),
    type: String(r.type),
    status: String(r.status),
    sourceQuote: r.source_quote == null ? null : String(r.source_quote),
    recallCount: Number(r.recall_count ?? 0),
    confidence: Number(r.confidence ?? 0.7),
    createdAt: String(r.created_at),
    kvRef: r.kv_ref == null ? null : String(r.kv_ref),
  }));
}

async function logHistory(
  memoryId: string,
  userId: string,
  operation: string,
  oldValue: unknown,
  newValue: unknown,
) {
  await db.insert(memoryHistory).values({
    memoryId,
    userId,
    operation,
    oldValue: oldValue as object,
    newValue: newValue as object,
    actor: "user",
  });
}

export async function setMemoryStatus(
  userId: string,
  id: string,
  status: "active" | "pinned" | "forgotten",
) {
  await db
    .update(memories)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  await logHistory(id, userId, status === "forgotten" ? "forgotten" : "status", null, { status });
}

export async function updateMemoryContent(userId: string, id: string, content: string) {
  const v = await embed(content);
  await db
    .update(memories)
    .set({
      content,
      contentHash: hash(normalize(content)),
      embedding: v,
      confidence: 1, // the user confirmed it in their own words — now certain
      userVerifiedAt: new Date(), // user-edit-wins lock
      updatedAt: new Date(),
    })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  await logHistory(id, userId, "updated", null, { content });
}

// ── consent contract / settings (the Dot-killer) ─────────
export async function getSettings(userId: string) {
  const [u] = await db
    .select({
      freqDial: users.freqDial,
      quietHoursStart: users.quietHoursStart,
      quietHoursEnd: users.quietHoursEnd,
      voice: users.voice,
      personaBio: users.personaBio,
      timezone: users.timezone,
      proactivityPaused: users.proactivityPaused,
      ageAffirmedAt: users.ageAffirmedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  return u;
}

/** SB243 self-attestation — stamp that the user affirmed they're 18 or older. */
export async function setAgeAffirmed(userId: string): Promise<void> {
  await db.update(users).set({ ageAffirmedAt: new Date() }).where(eq(users.id, userId));
}

export async function updateSettings(
  userId: string,
  patch: Partial<{
    freqDial: number;
    quietHoursStart: number;
    quietHoursEnd: number;
    voice: string;
    personaBio: string | null;
    proactivityPaused: boolean;
  }>,
) {
  // Every field is optional, so an empty object reaches drizzle and throws "No values to set".
  if (!Object.keys(patch).length) return;
  await db.update(users).set(patch).where(eq(users.id, userId));
}

/** The persona block (khoj: persona is data, the model stays fixed). Empty string when unset. */
export async function personaBlock(userId: string): Promise<string> {
  const [u] = await db.select({ bio: users.personaBio }).from(users).where(eq(users.id, userId));
  const bio = (u?.bio ?? "").trim();
  // The overnight self-portrait rides along when one exists - the model's own evolving read of
  // who this person is, maintained nightly (selfModel.ts). Bio (their words) always outranks it.
  let portrait = "";
  try {
    const rows = (await db.execute(sql`
      SELECT content FROM reflection_artifacts
      WHERE user_id = ${userId} AND thread_key = 'self_model'
      ORDER BY created_at DESC LIMIT 1
    `)) as unknown as { content: { text?: string } }[];
    portrait = String(rows[0]?.content?.text ?? "").trim();
  } catch {
    /* the portrait is an enhancement - persona must never fail because of it */
  }
  const parts: string[] = [];
  if (bio) {
    parts.push(`About this person, in their own words (honor it):\n${bio.slice(0, 800)}`);
  }
  if (portrait) {
    parts.push(
      `Your own evolving portrait of them (revise silently as they change):\n${portrait.slice(0, 1400)}`,
    );
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

// ── provenance X-ray: where a memory came from ───────────
export type Provenance = {
  content: string;
  sourceQuote: string | null;
  recallCount: number;
  sourceText: string | null;
  entryAt: string | null;
  kvRef: string | null;
};

export async function getMemoryProvenance(
  userId: string,
  memoryId: string,
): Promise<Provenance | null> {
  const rows = (await db.execute(sql`
    SELECT m.content, m.source_quote, m.recall_count,
           e.text AS source_text, e.created_at AS entry_at, e.kv_ref
    FROM memories m
    LEFT JOIN entries e ON e.id = m.source_entry_id
    WHERE m.id = ${memoryId} AND m.user_id = ${userId}
    LIMIT 1
  `)) as unknown as Record<string, unknown>[];
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    content: String(r.content),
    sourceQuote: r.source_quote == null ? null : String(r.source_quote),
    recallCount: Number(r.recall_count ?? 0),
    sourceText: r.source_text == null ? null : String(r.source_text),
    entryAt: r.entry_at == null ? null : String(r.entry_at),
    kvRef: r.kv_ref == null ? null : String(r.kv_ref),
  };
}
