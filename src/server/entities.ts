import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { embed, toVectorLiteral } from "./embed";

const { memoryEntities } = schema;

// The entity store (mem0): every person/place/project a memory mentions gets a row, deduped by
// name-embedding similarity at write time. Retrieval treats matched entities as a third arm with
// mem0's crowd damping - an entity linked to everything ("work") boosts nothing much, a specific
// one ("Mara") pulls its memories in hard.

const MERGE_SIM = 0.95; // near-identical names collapse into one entity
const MATCH_SIM = 0.55; // a query must genuinely resemble the entity to trigger the boost

/** mem0's crowd-damped boost weight for an entity with n linked memories. */
export function entityBoostWeight(sim: number, n: number): number {
  return sim * 0.5 * (1 / (1 + 0.001 * (n - 1) ** 2));
}

/** Record that a memory mentions these entities: merge into near-duplicates or create rows. */
export async function upsertEntities(
  userId: string,
  memoryId: string,
  names: string[],
): Promise<void> {
  for (const rawName of names) {
    const name = rawName.trim().slice(0, 80);
    if (name.length < 2) continue;
    const v = await embed(name);
    const lit = toVectorLiteral(v);
    const [near] = (await db.execute(sql`
      SELECT id, memory_ids, 1 - (embedding <=> ${lit}::vector) AS sim
      FROM memory_entities
      WHERE user_id = ${userId} AND embedding IS NOT NULL
      ORDER BY embedding <=> ${lit}::vector LIMIT 1
    `)) as unknown as Record<string, unknown>[];
    if (near && Number(near.sim) >= MERGE_SIM) {
      const ids = new Set((near.memory_ids as string[] | null) ?? []);
      ids.add(memoryId);
      await db
        .update(memoryEntities)
        .set({
          memoryIds: [...ids],
          mentionCount: sql`${memoryEntities.mentionCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(memoryEntities.id, String(near.id)));
    } else {
      await db.insert(memoryEntities).values({
        userId,
        name,
        embedding: v,
        memoryIds: [memoryId],
      });
    }
  }
}

export type EntityMatch = { id: string; name: string; sim: number; memoryIds: string[] };

/** Entities the query resembles, best first. */
export async function matchEntities(
  userId: string,
  queryVec: number[],
  limit = 3,
): Promise<EntityMatch[]> {
  const lit = toVectorLiteral(queryVec);
  const rows = (await db.execute(sql`
    SELECT id, name, memory_ids, 1 - (embedding <=> ${lit}::vector) AS sim
    FROM memory_entities
    WHERE user_id = ${userId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${lit}::vector LIMIT ${limit}
  `)) as unknown as Record<string, unknown>[];
  return rows
    .filter((r) => Number(r.sim) >= MATCH_SIM)
    .map((r) => ({
      id: String(r.id),
      name: String(r.name),
      sim: Number(r.sim),
      memoryIds: (r.memory_ids as string[] | null) ?? [],
    }));
}
