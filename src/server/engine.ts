import { createHash } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import { db, schema } from "../db";
import { embed, toVectorLiteral } from "./embed";
import { chat } from "./llm";
import { putData } from "./og";

const { users, entries, replies, memories, memoryHistory } = schema;

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
export async function saveEntry(userId: string, text: string, vec?: number[]) {
  const v = vec ?? (await embed(text));
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

// ── retrieve relevant raw entries (for Ask My Life receipts) ──
export type EntryHit = { id: string; text: string; createdAt: string; score: number };

export async function retrieveEntries(
  userId: string,
  queryVec: number[],
  k = 5,
): Promise<EntryHit[]> {
  const lit = toVectorLiteral(queryVec);
  const rows = await db.execute(sql`
    SELECT id, text, created_at, 1 - (embedding <=> ${lit}::vector) AS score
    FROM entries
    WHERE user_id = ${userId} AND embedding IS NOT NULL
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

// ── 0G Storage: encrypt + store each entry under a per-user key ──
// Per-user AES key derived deterministically (testnet demo; production = HKDF + KMS).
export function keyForUser(userId: string): Uint8Array {
  const pk = process.env.EVM_PRIVATE_KEY ?? "knole-dev-master";
  return new Uint8Array(createHash("sha256").update(`${pk}:${userId}`).digest());
}

export async function storeEntryOn0G(
  userId: string,
  entryId: string,
  text: string,
): Promise<string> {
  const key = keyForUser(userId);
  const payload = JSON.stringify({ entryId, text, savedAt: new Date().toISOString() });
  const { rootHash } = await putData(payload, { key });
  await db.update(entries).set({ kvRef: rootHash }).where(eq(entries.id, entryId));
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
  createdAt: string;
  kvRef: string | null;
};

export async function listMemories(userId: string): Promise<MemoryRow[]> {
  const rows = await db.execute(sql`
    SELECT m.id, m.content, m.type, m.status, m.source_quote, m.recall_count, m.created_at, e.kv_ref
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
      userVerifiedAt: new Date(), // user-edit-wins lock
      updatedAt: new Date(),
    })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
  await logHistory(id, userId, "updated", null, { content });
}
