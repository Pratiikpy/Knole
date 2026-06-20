import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  vector,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Embedding dimension = all-MiniLM-L6-v2 (local, private, free). Change here if the model changes.
export const EMBED_DIM = 384;

// ── enums ────────────────────────────────────────────────
export const entryType = pgEnum("entry_type", ["journal", "chat", "saved"]);
export const memoryType = pgEnum("memory_type", [
  "fact",
  "pattern",
  "commitment",
  "relationship",
  "preference",
  "value",
  "emotion",
]);
export const memorySector = pgEnum("memory_sector", [
  "episodic",
  "semantic",
  "procedural",
  "emotional",
  "reflective",
]);
export const memoryStatus = pgEnum("memory_status", [
  "candidate",
  "active",
  "pinned",
  "corrected",
  "archived",
  "forgotten",
  "superseded",
  "rejected",
]);
export const actorType = pgEnum("actor_type", ["user", "ai", "system"]);
export const feedbackAction = pgEnum("feedback_action", [
  "helpful",
  "wrong",
  "too_much",
  "creepy",
  "save",
  "forget",
]);
export const artifactType = pgEnum("artifact_type", [
  "daily_mirror",
  "weekly_mirror",
  "monthly_essence",
  "open_loop",
  "pattern",
  "commitment",
  "state",
]);

// ── users ────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  privyId: text("privy_id").unique(),
  email: text("email"),
  walletAddress: text("wallet_address"),
  kvNamespace: text("kv_namespace"), // per-user 0G KV namespace
  timezone: text("timezone").default("UTC"),
  plan: text("plan").default("free"),
  // proactivity consent (the Dot-killer)
  quietHoursStart: integer("quiet_hours_start").default(22),
  quietHoursEnd: integer("quiet_hours_end").default(8),
  freqDial: integer("freq_dial").default(3), // nudges/week, downward-only
  proactivityPaused: boolean("proactivity_paused").default(false),
  voice: text("voice").default("structural"),
  // "Save to Knole" extension: sha256 of the user's high-entropy token (the raw token is
  // shown once and never stored). null until they generate one.
  extensionTokenHash: text("extension_token_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── entries (journal/chat/saved) ─────────────────────────
export const entries = pgTable(
  "entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: entryType("type").default("journal").notNull(),
    text: text("text").notNull(),
    mood: text("mood"),
    embedding: vector("embedding", { dimensions: EMBED_DIM }),
    kvRef: text("kv_ref"), // 0G KV pointer (source of truth)
    anchoredRoot: text("anchored_root"), // on-chain memory-root anchor
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("entries_user_idx").on(t.userId),
    index("entries_emb_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// ── replies (Pile model: an AI reflection is a reply with isAi=true) ──
export const replies = pgTable(
  "replies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentEntryId: uuid("parent_entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    isAi: boolean("is_ai").default(false).notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("replies_parent_idx").on(t.parentEntryId)],
);

// ── memories (the moat) ──────────────────────────────────
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(), // sha256(normalized) — dedup
    type: memoryType("type").default("fact").notNull(),
    sector: memorySector("sector").default("episodic").notNull(),
    status: memoryStatus("status").default("candidate").notNull(),
    confidence: real("confidence").default(0.5),
    importance: real("importance").default(0.5),
    // provenance (powers the recall X-ray)
    sourceEntryId: uuid("source_entry_id").references(() => entries.id, { onDelete: "set null" }),
    sourceQuote: text("source_quote"),
    lastUsedInReplyId: uuid("last_used_in_reply_id"),
    provenance: jsonb("provenance"),
    // recall-stats (importance earned by use — OpenClaw)
    recallCount: integer("recall_count").default(0),
    distinctQueryCount: integer("distinct_query_count").default(0),
    distinctDayCount: integer("distinct_day_count").default(0),
    lastRecalledAt: timestamp("last_recalled_at"),
    embedding: vector("embedding", { dimensions: EMBED_DIM }),
    // bi-temporal supersede-not-delete (graphiti/C.O.R.E.)
    validAt: timestamp("valid_at").defaultNow(),
    invalidAt: timestamp("invalid_at"),
    invalidatedBy: uuid("invalidated_by"),
    userVerifiedAt: timestamp("user_verified_at"), // user-edit-wins lock
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("memories_user_idx").on(t.userId),
    uniqueIndex("memories_user_hash_uniq").on(t.userId, t.contentHash),
    index("memories_emb_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// ── append-only audit (never silently overwrite) ─────────
export const memoryHistory = pgTable(
  "memory_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memoryId: uuid("memory_id").notNull(),
    userId: uuid("user_id").notNull(),
    operation: text("operation").notNull(), // created|updated|superseded|archived|forgotten|restored
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    actor: actorType("actor").default("system").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("memory_history_user_idx").on(t.userId),
  }),
);

// ── reflection artifacts (Daily/Weekly Mirror, state consolidation) ──
export const reflectionArtifacts = pgTable(
  "reflection_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: artifactType("type").notNull(),
    threadKey: text("thread_key"),
    content: jsonb("content").notNull(),
    sources: jsonb("sources"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userThreadIdx: index("reflection_artifacts_user_thread_idx").on(t.userId, t.threadKey),
  }),
);

// ── feedback (feeds the evals + proactivity tuning) ──────
export const memoryFeedback = pgTable("memory_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  memoryId: uuid("memory_id"),
  replyId: uuid("reply_id"),
  action: feedbackAction("action").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── imports (the refugee wedge) ──────────────────────────
export const imports = pgTable("imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sourcePlatform: text("source_platform"), // chatgpt|replika|claude|text
  status: text("status").default("pending"),
  rawRef: text("raw_ref"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── eval runs (release gate) ─────────────────────────────
export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  suite: text("suite").notNull(),
  passed: boolean("passed"),
  score: real("score"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
