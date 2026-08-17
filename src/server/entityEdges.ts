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

const EDGE_SYS = `Extract relationships between NAMED entities from a journal entry. "You" (the writer) counts as an entity.

Rules:
- Both ends must be proper names or "You" - never generic words ("work", "the team").
- relation is a SHORT_UPPER_SNAKE verb phrase: WORKS_AT, DATING, FRIEND_OF, MANAGES, LIVES_IN, MARRIED_TO, STUDYING_AT, BUILDING, ESTRANGED_FROM...
- fact preserves the specifics in one sentence, second person where the writer is involved. Never generalize.
- Only durable relationships worth remembering - not one-off interactions ("had coffee with" is not an edge; "is your closest friend" is).
- ended=true when the entry says this relationship has ENDED (quit, broke up, moved away).

Return ONLY a JSON array: [{"source": "You", "target": "Mara", "relation": "FRIEND_OF", "fact": "Mara is your closest friend from the Meridian Labs days.", "ended": false}]
Return [] when there are none.`;

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
  const r = await chatPrivate(
    [
      { role: "system", content: EDGE_SYS },
      { role: "user", content: entryText.slice(0, 6000) },
    ],
    { temperature: 0, maxTokens: 900 },
  );
  const parsed = parseModelJson<unknown>(
    `{"edges": ${r.content.match(/\[[\s\S]*\]/)?.[0] ?? "[]"}}`,
    {
      edges: [],
    },
  ) as { edges?: unknown };
  const raw = Array.isArray(parsed.edges) ? parsed.edges : [];
  let written = 0;
  for (const e of raw.slice(0, 8)) {
    const t = e as {
      source?: unknown;
      target?: unknown;
      relation?: unknown;
      fact?: unknown;
      ended?: unknown;
    };
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

    // graphiti's invalidation arithmetic, in SQL: a live edge for the same (pair, relation) is
    // superseded by this newer fact - its invalid_at becomes the new edge's valid_at. An edge the
    // entry says has ENDED writes no new live edge; it closes the old one.
    await db.execute(sql`
      UPDATE memory_entity_edges SET invalid_at = ${writtenAt.toISOString()}
      WHERE user_id = ${userId} AND invalid_at IS NULL
        AND lower(source_name) = ${source.toLowerCase()} AND lower(target_name) = ${target.toLowerCase()}
        AND relation = ${relation} AND valid_at < ${writtenAt.toISOString()}
    `);
    if (t.ended === true) {
      written++;
      continue;
    }
    await db.execute(sql`
      INSERT INTO memory_entity_edges (user_id, source_name, target_name, relation, fact, source_memory_id, valid_at)
      VALUES (${userId}, ${source}, ${target}, ${relation}, ${t.fact.slice(0, 400)}, ${memoryId}, ${writtenAt.toISOString()})
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
