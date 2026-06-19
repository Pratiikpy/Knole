import { createHash } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import { db, schema } from "../db";
import { embed, toVectorLiteral } from "./embed";
import { chat } from "./llm";

const { users, entries, replies, memories } = schema;

const VALID_TYPES = new Set([
  "fact", "pattern", "commitment", "relationship", "preference", "value", "emotion",
]);

// ── demo user (until Privy auth lands) ───────────────────
let demoUserIdP: Promise<string> | null = null;
export function getDemoUserId(): Promise<string> {
  if (!demoUserIdP) {
    demoUserIdP = (async () => {
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.privyId, "demo"))
        .limit(1);
      if (found[0]) return found[0].id;
      const ins = await db
        .insert(users)
        .values({ privyId: "demo", email: "demo@knole.local" })
        .returning({ id: users.id });
      return ins[0].id;
    })();
  }
  return demoUserIdP;
}

// ── save an entry (+ local embedding) ────────────────────
export async function saveEntry(userId: string, text: string) {
  const v = await embed(text);
  const [row] = await db
    .insert(entries)
    .values({ userId, text, type: "journal", embedding: v })
    .returning();
  return row;
}

export async function saveReply(entryId: string, text: string, isAi = true) {
  const [row] = await db
    .insert(replies)
    .values({ parentEntryId: entryId, text, isAi })
    .returning();
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

export async function retrieveMemories(
  userId: string,
  queryVec: number[],
  k = 6,
): Promise<Recalled[]> {
  const lit = toVectorLiteral(queryVec);
  const rows = await db.execute(sql`
    SELECT id, content, source_quote, created_at,
           1 - (embedding <=> ${lit}::vector) AS score
    FROM memories
    WHERE user_id = ${userId}
      AND status IN ('active', 'pinned')
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${lit}::vector
    LIMIT ${k}
  `);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    content: String(r.content),
    sourceQuote: r.source_quote == null ? null : String(r.source_quote),
    createdAt: r.created_at == null ? null : String(r.created_at),
    score: Number(r.score),
  }));
}

// ── extract durable memories from an entry (+ dedup) ─────
const EXTRACT_SYS = `Extract durable, useful long-term memories about the user from their journal entry. Only keep things worth remembering across future sessions: facts, people, goals, recurring feelings or patterns, commitments, preferences, values. Ignore fleeting detail.
Return a JSON array; each item: {"content": "<concise third-person fact about the user>", "type": "fact|pattern|commitment|relationship|preference|value|emotion", "quote": "<short verbatim quote from the entry supporting it>"}.
Return [] if nothing durable. Output ONLY the JSON array, no prose.`;

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export async function extractMemories(userId: string, entryId: string, entryText: string) {
  const raw = await chat(
    [
      { role: "system", content: EXTRACT_SYS },
      { role: "user", content: entryText },
    ],
    { temperature: 0.2, maxTokens: 700 },
  );

  let items: { content?: string; type?: string; quote?: string }[] = [];
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    items = m ? JSON.parse(m[0]) : [];
  } catch {
    items = [];
  }

  const saved: { id: string; content: string }[] = [];
  for (const it of items) {
    if (!it?.content) continue;
    const type = it.type && VALID_TYPES.has(it.type) ? it.type : "fact";
    const ch = hash(normalize(it.content));
    const v = await embed(it.content);
    // content-hash UPSERT dedup (memori): reinforce on conflict instead of duplicating
    const res = await db.execute(sql`
      INSERT INTO memories
        (user_id, content, content_hash, type, status, source_entry_id, source_quote, embedding, confidence, importance)
      VALUES
        (${userId}, ${it.content}, ${ch}, ${type}, 'active', ${entryId}, ${it.quote ?? null}, ${toVectorLiteral(v)}::vector, 0.7, 0.6)
      ON CONFLICT (user_id, content_hash)
        DO UPDATE SET recall_count = memories.recall_count + 1, updated_at = now()
      RETURNING id, content
    `);
    const row = (res as unknown as Record<string, unknown>[])[0];
    if (row) saved.push({ id: String(row.id), content: String(row.content) });
  }
  return saved;
}
