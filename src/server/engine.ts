import { createHash, hkdfSync } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import { db, schema } from "../db";
import { embed, toVectorLiteral } from "./embed";
import { chat } from "./llm";
import { putData } from "./og";

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
    })();
  }
  return demoUserIdP;
}

// ── save an entry (+ local embedding) ────────────────────
export async function saveEntry(
  userId: string,
  text: string,
  vec?: number[],
  type: "journal" | "chat" | "saved" = "journal",
) {
  const v = vec ?? (await embed(text));
  const [row] = await db.insert(entries).values({ userId, text, type, embedding: v }).returning();
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

export async function retrieveMemories(
  userId: string,
  queryVec: number[],
  k = 6,
  queryText?: string,
): Promise<Recalled[]> {
  const lit = toVectorLiteral(queryVec);
  const useHybrid = !!queryText && queryText.trim().length > 0;
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
                   ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${queryText})) DESC
                 ) AS rnk
          FROM memories
          WHERE user_id = ${userId} AND status IN ('active', 'pinned')
            AND to_tsvector('english', content) @@ plainto_tsquery('english', ${queryText})
          ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${queryText})) DESC
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
Write each memory in the second person, addressed to them — "You…" / "Your…" (e.g. "You're training for the Chicago marathon", "Your sister Mara is a steady support"). Never write "the user" or "they".
Return a JSON array; each item: {"content": "<concise fact about them, in second person>", "type": "fact|pattern|commitment|relationship|preference|value|emotion", "quote": "<short verbatim quote from the entry supporting it>", "confidence": <0.0-1.0 — how sure you are this is true and lasting: ~0.9 for something they state plainly, ~0.6 for a fair inference, ~0.4 for a tentative read you're guessing at>}.
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
  const r = (
    await chat(
      [
        { role: "system", content: RECONCILE_SYS },
        { role: "user", content: `OLD: ${oldContent}\nNEW: ${newContent}` },
      ],
      { temperature: 0, maxTokens: 4 },
    )
  )
    .trim()
    .toLowerCase();
  if (r.startsWith("update")) return "update";
  if (r.startsWith("duplicate")) return "duplicate";
  return "independent";
}

export async function extractMemories(userId: string, entryId: string, entryText: string) {
  const raw = await chat(
    [
      { role: "system", content: EXTRACT_SYS },
      { role: "user", content: entryText },
    ],
    { temperature: 0.2, maxTokens: 700 },
  );

  let items: { content?: string; type?: string; quote?: string; confidence?: number }[] = [];
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
    const type = it.type && VALID_TYPES.has(it.type) ? it.type : "fact";
    // How sure the model is this memory is true + durable. Clamp to a sane floor so a missing/garbage
    // value still lands at the old default. Earned higher later by recall + a user edit.
    const conf = Math.max(0.3, Math.min(1, Number(it.confidence) || 0.7));
    const ch = hash(normalize(it.content));
    const v = await embed(it.content);
    const vlit = toVectorLiteral(v);

    // reconcile: does this update/replace a similar-but-different existing memory?
    const sim = (await db.execute(sql`
      SELECT id, content, status, user_verified_at, 1 - (embedding <=> ${vlit}::vector) AS score
      FROM memories
      WHERE user_id = ${userId} AND status IN ('active', 'pinned')
        AND content_hash <> ${ch} AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vlit}::vector
      LIMIT 1
    `)) as unknown as Record<string, unknown>[];
    let supersededId: string | null = null;
    if (sim[0] && Number(sim[0].score) >= 0.45) {
      const verdict = await judgeMemory(String(sim[0].content), it.content);
      if (verdict === "duplicate") {
        // NOOP: reinforce the existing memory instead of storing a near-duplicate
        await db.execute(sql`
          UPDATE memories SET recall_count = recall_count + 1, updated_at = now()
          WHERE id = ${String(sim[0].id)} AND user_id = ${userId}
        `);
        saved.push({ id: String(sim[0].id), content: String(sim[0].content) });
        continue;
      }
      // update: supersede the prior memory — but never one the user controls. A pin
      // (pinned-survival) or a hand-edit (user_verified_at, the user-edit-wins lock) outranks
      // the engine's inference; the new memory is added alongside it, for the user to reconcile.
      const userControlled = String(sim[0].status) === "pinned" || sim[0].user_verified_at != null;
      if (verdict === "update" && !userControlled) {
        supersededId = String(sim[0].id);
      }
    }

    // content-hash UPSERT dedup (memori): reinforce on conflict instead of duplicating
    const res = await db.execute(sql`
      INSERT INTO memories
        (user_id, content, content_hash, type, status, source_entry_id, source_quote, embedding, confidence, importance)
      VALUES
        (${userId}, ${it.content}, ${ch}, ${type}, 'active', ${entryId}, ${it.quote ?? null}, ${vlit}::vector, ${conf}, 0.6)
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
    if (row) saved.push({ id: String(row.id), content: String(row.content) });
  }
  return saved;
}

// ── 0G Storage: encrypt + store each entry under a per-user key ──
// Per-user AES-256 key via HKDF from a dedicated master secret (production = hold the secret in a KMS).
export function keyForUser(userId: string): Uint8Array {
  const secret = process.env.KNOLE_KDF_SECRET;
  if (!secret)
    throw new Error("KNOLE_KDF_SECRET is required to derive the per-user encryption key");
  // HKDF-SHA256 with a dedicated master secret (NOT the chain signing key);
  // per-user domain separation via the info parameter.
  return new Uint8Array(
    hkdfSync("sha256", secret, "knole-hkdf-salt-v1", `entry-key:${userId}`, 32),
  );
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
      timezone: users.timezone,
      proactivityPaused: users.proactivityPaused,
    })
    .from(users)
    .where(eq(users.id, userId));
  return u;
}

export async function updateSettings(
  userId: string,
  patch: Partial<{
    freqDial: number;
    quietHoursStart: number;
    quietHoursEnd: number;
    voice: string;
    proactivityPaused: boolean;
  }>,
) {
  await db.update(users).set(patch).where(eq(users.id, userId));
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
