import { sql } from "drizzle-orm";
import { db } from "../db";

export type Mindfile = {
  exportedAt: string;
  counts: { entries: number; memories: number; onChain: number };
  entries: { text: string; type: string; createdAt: string; onChain: string | null }[];
  memories: {
    content: string;
    type: string;
    sourceQuote: string | null;
    recalled: number;
    createdAt: string;
  }[];
};

/**
 * The whole mind, in one file: every entry and every active memory, in plain JSON.
 * Delivers the product's core ownership promise — walk away with all of it, anytime.
 */
export async function exportMindfile(userId: string): Promise<Mindfile> {
  const entryRows = (await db.execute(sql`
    SELECT text, type, created_at, kv_ref FROM entries
    WHERE user_id = ${userId} ORDER BY created_at ASC
  `)) as unknown as Record<string, unknown>[];
  const memRows = (await db.execute(sql`
    SELECT content, type, source_quote, recall_count, created_at FROM memories
    WHERE user_id = ${userId} AND status NOT IN ('forgotten', 'superseded', 'rejected')
    ORDER BY created_at ASC
  `)) as unknown as Record<string, unknown>[];

  const entries = entryRows.map((e) => ({
    text: String(e.text),
    type: String(e.type),
    createdAt: String(e.created_at),
    onChain: e.kv_ref == null ? null : String(e.kv_ref),
  }));
  const memories = memRows.map((m) => ({
    content: String(m.content),
    type: String(m.type),
    sourceQuote: m.source_quote == null ? null : String(m.source_quote),
    recalled: Number(m.recall_count ?? 0),
    createdAt: String(m.created_at),
  }));

  return {
    exportedAt: new Date().toISOString(),
    counts: {
      entries: entries.length,
      memories: memories.length,
      onChain: entries.filter((e) => e.onChain).length,
    },
    entries,
    memories,
  };
}
