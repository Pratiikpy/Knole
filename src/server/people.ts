import { sql } from "drizzle-orm";
import { db } from "../db";
import { edgesForEntity, entityTimeline, type EntityEdge, type TimelineStep } from "./entityEdges";

// The People surface. Everything here was already being stored — entities from extraction, typed
// edges from the relationship arm, and the bi-temporal memory history — but nothing ever showed it
// back. Only Ask touched the edges, so the one thing an ordinary journal cannot do (tell you how a
// relationship actually changed, with dates) was invisible. This reads it; it writes nothing.

export type PersonSummary = {
  name: string;
  mentions: number;
  memories: number;
  liveTies: number;
  endedTies: number;
  lastSeen: string | null;
};

/**
 * Everyone the journal knows, most-present first. Entities and edge endpoints are unioned because
 * the two arms discover names independently — a person can exist only as one end of an edge.
 */
export async function listPeople(userId: string): Promise<PersonSummary[]> {
  const rows = (await db.execute(sql`
    WITH names AS (
      SELECT name, mention_count, jsonb_array_length(memory_ids) AS mem_count, updated_at
        FROM memory_entities WHERE user_id = ${userId}
      UNION ALL
      SELECT source_name AS name, 0, 0, created_at FROM memory_entity_edges WHERE user_id = ${userId}
      UNION ALL
      SELECT target_name AS name, 0, 0, created_at FROM memory_entity_edges WHERE user_id = ${userId}
    ),
    grouped AS (
      SELECT lower(name) AS key, max(name) AS name,
             max(mention_count) AS mentions, max(mem_count) AS memories, max(updated_at) AS last_seen
      FROM names WHERE lower(name) <> 'you' GROUP BY lower(name)
    )
    SELECT g.name, g.mentions, g.memories, g.last_seen,
      (SELECT count(*) FROM memory_entity_edges e
        WHERE e.user_id = ${userId} AND e.invalid_at IS NULL
          AND (lower(e.source_name) = g.key OR lower(e.target_name) = g.key))::int AS live_ties,
      (SELECT count(*) FROM memory_entity_edges e
        WHERE e.user_id = ${userId} AND e.invalid_at IS NOT NULL
          AND (lower(e.source_name) = g.key OR lower(e.target_name) = g.key))::int AS ended_ties
    FROM grouped g
    ORDER BY (g.mentions + g.memories) DESC, g.last_seen DESC NULLS LAST
    LIMIT 60
  `)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    name: String(r.name),
    mentions: Number(r.mentions ?? 0),
    memories: Number(r.memories ?? 0),
    liveTies: Number(r.live_ties ?? 0),
    endedTies: Number(r.ended_ties ?? 0),
    lastSeen: r.last_seen ? new Date(String(r.last_seen)).toISOString() : null,
  }));
}

export type PersonStory = {
  name: string;
  known: boolean;
  live: EntityEdge[];
  past: EntityEdge[];
  timeline: TimelineStep[];
  entries: { id: string; date: string; text: string }[];
};

/** One person's whole story: how things stand, how they changed, and the days they were written. */
export async function personStory(userId: string, name: string): Promise<PersonStory> {
  const like = `%${name.replace(/[%_\\]/g, "\\$&")}%`;
  const [edges, timeline, entryRows] = await Promise.all([
    edgesForEntity(userId, name, 40),
    entityTimeline(userId, name),
    // Broad match in SQL, exact word-boundary check in JS. The Neon driver strips backslashes out
    // of inline SQL, so a \m...\M regex silently stops matching there — the boundary test belongs
    // where the escaping is dependable, and it keeps "Sam" from lighting up on "Samantha".
    db.execute(sql`
      SELECT id, created_at, text FROM entries
      WHERE user_id = ${userId} AND deleted_at IS NULL AND type <> 'chat' AND text ILIKE ${like}
      ORDER BY created_at DESC LIMIT 60
    `) as unknown as Promise<Record<string, unknown>[]>,
  ]);
  const word = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const entries = (entryRows as unknown as Record<string, unknown>[])
    .filter((r) => word.test(String(r.text)))
    .slice(0, 12)
    .map((r) => ({
      id: String(r.id),
      date: new Date(String(r.created_at)).toISOString(),
      text: String(r.text),
    }));
  return {
    name,
    known: edges.length > 0 || timeline.length > 0 || entries.length > 0,
    live: edges.filter((e) => !e.invalidAt),
    past: edges.filter((e) => e.invalidAt),
    timeline,
    entries,
  };
}
