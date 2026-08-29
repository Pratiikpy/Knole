import { sql } from "drizzle-orm";
import { db } from "../db";
import { chatPrivate } from "./sealed";
import { parseModelJson } from "./llmJson";

// Typed relationship edges (graphiti's EntityEdge + resolve_edge_contradictions, ported to
// Postgres and to Knole's flat-cost extraction budget).
//
// The entity arm knew WHO appears in a journal; edges add HOW things connect: "Mara WORKS_AT
// Meridian Labs", "You DATING Sam since 2026-03". Bi-temporal like memories - an edge is never
// deleted, it's invalidated by the newer fact that contradicts it, so "the story with Mara"
// can be told with its turns intact.
//
// Cost discipline: edge extraction is ONE extra model call per entry, only when the entry's
// memories actually carried 2+ entities - most entries skip it entirely. Contradiction checks
// are SQL (same user, same pair, same relation), not more model calls; the temporal arithmetic
// is graphiti's: the older edge's invalid_at becomes the newer edge's valid_at.

// Every clause here is load-bearing and was measured (see edges-eval.run.ts). The first version
// recalled 1 of 2 edges on a two-edge entry, for three reasons this one fixes: it read a pronoun
// subject ("she moved to Porto") as having no named source; it listed "moved away" as an ENDING
// signal, so relocations were suppressed instead of recorded; and its single one-element,
// person-to-person example anchored the output to one edge of that same shape.
export const EDGE_SYS = `Extract EVERY durable relationship between named entities in a journal entry. "You" (the writer) counts as an entity. Most entries carry more than one — never stop at the first.

Rules:
- Resolve pronouns first. If "she moved to Porto" refers to Teodora, the edge is Teodora → Porto. A pronoun subject is NEVER a reason to skip an edge.
- Both ends must resolve to a proper name (person, place, organisation) or "You" — never a generic word ("work", "the team", "the flat").
- relation is a SHORT_UPPER_SNAKE verb phrase: WORKS_AT, LIVES_IN, DATING, MARRIED_TO, FRIEND_OF, SIBLING_OF, PARENT_OF, MANAGES, STUDYING_AT, CO_FOUNDER_OF, THERAPIST_OF, BUILDING, ESTRANGED_FROM...
- A single entry can carry a person→person AND a person→place AND a person→organisation edge. Emit all of them.
- fact preserves the specifics in one sentence, second person where the writer is involved. Never generalize.
- Durable only — a state that holds beyond a single day. "Had coffee with Nina" is not an edge; "Nina is your closest friend" is.
- A relationship that has ALREADY ended still counts — record it with ended=true instead of dropping it. "We both worked at Zalando before" is two WORKS_AT edges, both ended. The history is the point.
- Never infer a relationship the entry does not state. "Marcus has been in Bristol since the divorce" says nothing about who was married to whom — do not invent one.
- ended=true ONLY when the entry says THAT relationship has stopped (quit the job, broke up, cut contact). Moving INTO a new city, job or course is NOT an ending — it is a new edge, and the old one is superseded for you automatically.

Return ONLY a JSON array, one object per relationship:
[{"source": "You", "target": "Mara", "relation": "FRIEND_OF", "fact": "Mara is your closest friend from the Meridian Labs days.", "ended": false},
 {"source": "Mara", "target": "Lisbon", "relation": "LIVES_IN", "fact": "Mara moved to Lisbon in March 2026.", "ended": false}]
Return [] when the entry has none.`;

// Relations a person can only hold ONE of at a time: a new target supersedes the old edge rather
// than sitting beside it. Without this, "moved to Porto" leaves "lives in Lisbon" live forever and
// the timeline reads as though both were true. FRIEND_OF/MANAGES/BUILDING are deliberately absent —
// those legitimately hold many targets at once.
const EXCLUSIVE_RELATIONS = new Set([
  "LIVES_IN",
  "WORKS_AT",
  "MARRIED_TO",
  "STUDYING_AT",
  "DATING",
]);

export type ParsedEdge = {
  source: string;
  target: string;
  relation: string;
  fact: string;
  ended: boolean;
};

/**
 * The model half of extraction, kept free of the database so recall can be measured directly
 * (`npm run eval:edges`). `sys` is injectable only so an eval can A/B a candidate prompt.
 */
export async function extractEdgesFromText(
  entryText: string,
  sys = EDGE_SYS,
): Promise<ParsedEdge[]> {
  // A response with no JSON array in it at all is a malformed answer, NOT an entry without
  // relationships — the two used to be indistinguishable, so a garbled reply silently wrote zero
  // edges and left a hole in the story no error would ever reveal. An explicit "[]" is trusted.
  let raw: unknown[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await chatPrivate(
      [
        { role: "system", content: sys },
        { role: "user", content: entryText.slice(0, 6000) },
      ],
      { temperature: 0, maxTokens: 900 },
    );
    const arr = r.content.match(/\[[\s\S]*\]/)?.[0];
    if (!arr) {
      if (attempt === 2)
        console.error("edge extraction: no JSON array in the model reply after a retry");
      continue;
    }
    const parsed = parseModelJson<unknown>(`{"edges": ${arr}}`, { edges: [] }) as {
      edges?: unknown;
    };
    raw = Array.isArray(parsed.edges) ? parsed.edges : [];
    break;
  }
  const out: ParsedEdge[] = [];
  for (const e of raw.slice(0, 10)) {
    const t = e as Record<string, unknown>;
    if (
      typeof t.source !== "string" ||
      typeof t.target !== "string" ||
      typeof t.relation !== "string" ||
      typeof t.fact !== "string"
    )
      continue;
    const source = canon(t.source);
    const target = canon(t.target);
    const relation = t.relation.trim().toUpperCase().replace(/\s+/g, "_").slice(0, 40);
    if (!source || !target || !relation || source.toLowerCase() === target.toLowerCase()) continue;
    out.push({ source, target, relation, fact: t.fact.slice(0, 400), ended: t.ended === true });
  }
  return out;
}

export type EntityEdge = {
  source: string;
  target: string;
  relation: string;
  fact: string;
  validAt: string;
  invalidAt: string | null;
};

const canon = (s: string) => s.trim().slice(0, 80);

/** Extract + persist relationship edges for an entry's text. One model call; SQL contradiction. */
export async function extractEntityEdges(
  userId: string,
  memoryId: string | null,
  entryText: string,
  writtenAt: Date,
): Promise<number> {
  const edges = await extractEdgesFromText(entryText);
  let written = 0;
  // Closures before openings. One entry routinely states both halves of a change ("she's leaving
  // Meridian, she's taken a role at Corvid"), and applying them in the model's arbitrary order let
  // the opening land first — so the closure then matched the NEW edge instead of the old one.
  const ordered = [...edges].sort((a, b) => Number(b.ended) - Number(a.ended));
  for (const { source, target, relation, fact, ended } of ordered) {
    const at = writtenAt.toISOString();
    const src = source.toLowerCase();
    const tgt = target.toLowerCase();

    if (ended) {
      // The entry says THIS tie stopped: close the live edge for the pair. Nothing new is written —
      // the closed row IS the history.
      const closed = (await db.execute(sql`
        UPDATE memory_entity_edges SET invalid_at = ${at}
        WHERE user_id = ${userId} AND invalid_at IS NULL
          AND lower(source_name) = ${src} AND lower(target_name) = ${tgt}
          AND relation = ${relation} AND valid_at < ${at}
        RETURNING id
      `)) as unknown as unknown[];
      // Only count a tie we actually closed. Counting the attempt made "3 edges written" mean
      // nothing when the entry ended a relationship the journal had never recorded.
      if (closed.length) written++;
      continue;
    }

    // (source, target, relation) IS the identity of an edge, so restating one is NOT a change.
    // Closing and re-opening it on every mention would date-stamp an ending that never happened —
    // "she's still at Halden Systems" would render as "NO LONGER TRUE since August". Refresh the
    // wording in place and leave valid_at alone, so the edge keeps the date it actually began.
    const same = (await db.execute(sql`
      UPDATE memory_entity_edges SET fact = ${fact}
      WHERE user_id = ${userId} AND invalid_at IS NULL
        AND lower(source_name) = ${src} AND lower(target_name) = ${tgt} AND relation = ${relation}
      RETURNING id
    `)) as unknown as unknown[];
    if (same.length) {
      written++;
      continue;
    }

    // A relation you can only hold one of at a time: a DIFFERENT target supersedes the old edge —
    // moving to Ghent ends living in Utrecht. Runs only when this really is a new edge.
    //
    // `valid_at <= at`, not `<`. A single entry that names both the old tie and the new one writes
    // them at the SAME instant, and the strict `<` meant the old one could never be closed — the
    // journal showed Mara working at Meridian Labs AND at Corvid at once, off an entry that plainly
    // said she was leaving. `target_name <> tgt` already protects the edge being opened, so the
    // wider bound cannot close the new row.
    if (EXCLUSIVE_RELATIONS.has(relation)) {
      await db.execute(sql`
        UPDATE memory_entity_edges SET invalid_at = ${at}
        WHERE user_id = ${userId} AND invalid_at IS NULL
          AND lower(source_name) = ${src} AND relation = ${relation}
          AND lower(target_name) <> ${tgt} AND valid_at <= ${at}
      `);
    }
    await db.execute(sql`
      INSERT INTO memory_entity_edges (user_id, source_name, target_name, relation, fact, source_memory_id, valid_at)
      VALUES (${userId}, ${source}, ${target}, ${relation}, ${fact}, ${memoryId}, ${at})
    `);
    written++;
  }
  return written;
}

/**
 * Every entity name this user's journal knows — the entity arm's rows UNION the edge endpoints.
 * The two arms discover names independently (an entity can exist only as an edge endpoint), so
 * Ask's who-is-this-question-about scan must see both. Name matching is exact-text, not embedding:
 * measured, a full question embeds nowhere near a bare name (best sim 0.19 vs the 0.55 bar).
 */
export async function knownEntityNames(userId: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT name FROM (
      SELECT name FROM memory_entities WHERE user_id = ${userId}
      UNION
      SELECT source_name AS name FROM memory_entity_edges WHERE user_id = ${userId}
      UNION
      SELECT target_name AS name FROM memory_entity_edges WHERE user_id = ${userId}
    ) t
    WHERE lower(name) <> 'you'
    LIMIT 200
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => String(r.name));
}

/** Every edge touching an entity name (live first, then history), for the story view + Ask. */
export async function edgesForEntity(
  userId: string,
  name: string,
  limit = 12,
): Promise<EntityEdge[]> {
  const rows = (await db.execute(sql`
    SELECT source_name, target_name, relation, fact, valid_at, invalid_at
    FROM memory_entity_edges
    WHERE user_id = ${userId}
      AND (lower(source_name) = ${name.toLowerCase()} OR lower(target_name) = ${name.toLowerCase()})
    ORDER BY (invalid_at IS NULL) DESC, valid_at DESC
    LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    source: String(r.source_name),
    target: String(r.target_name),
    relation: String(r.relation),
    fact: String(r.fact),
    validAt: new Date(String(r.valid_at)).toISOString(),
    invalidAt: r.invalid_at ? new Date(String(r.invalid_at)).toISOString() : null,
  }));
}

// ── the entity timeline (graphiti gap #1: history stored but never told) ─────

export type TimelineStep = {
  content: string;
  status: string;
  validAt: string | null;
  invalidAt: string | null;
  supersededBy: string | null;
};

/**
 * The dated story of an entity: every memory ever linked to it - active AND superseded - ordered
 * in time, with the supersede chain visible. This is "how has X changed" answered from data the
 * DB already held; retrieval always filtered superseded memories out, so the story was stored
 * but never told.
 */
export async function entityTimeline(userId: string, entityName: string): Promise<TimelineStep[]> {
  const rows = (await db.execute(sql`
    SELECT m.content, m.status, m.valid_at, m.invalid_at, m2.content AS superseded_by, m.created_at
    FROM memory_entities me,
         LATERAL jsonb_array_elements_text(me.memory_ids) AS mid(id)
    JOIN memories m ON m.id = mid.id::uuid AND m.user_id = ${userId}
    LEFT JOIN memories m2 ON m2.id = m.invalidated_by
    WHERE me.user_id = ${userId} AND lower(me.name) = ${entityName.toLowerCase()}
    ORDER BY COALESCE(m.valid_at, m.created_at) ASC
    LIMIT 40
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    content: String(r.content),
    status: String(r.status),
    validAt: r.valid_at ? new Date(String(r.valid_at)).toISOString() : null,
    invalidAt: r.invalid_at ? new Date(String(r.invalid_at)).toISOString() : null,
    supersededBy: r.superseded_by ? String(r.superseded_by) : null,
  }));
}
