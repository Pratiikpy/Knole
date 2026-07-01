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
  "weekly_essence",
  "monthly_essence",
  "yearly_essence",
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
  // Stripe billing — written only by verified webhooks. `plan` ("free" | "deep") is the entitlement.
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // The day-15 Mirror reveal ceremony fires once — stamped here (belt-and-suspenders with a
  // localStorage guard, so a storage clear can't replay it across devices).
  mirrorRevealedAt: timestamp("mirror_revealed_at"),
  // SB243 self-attestation age gate — stamped when the user affirms they're 18 or older.
  ageAffirmedAt: timestamp("age_affirmed_at"),
  // Client-side encryption: when enrolled, the 0G owned-copy is sealed under a wallet-derived key the
  // server never sees. The canary (a blob the user can decrypt) proves they can still derive a working
  // key each session; the address binds the key so a different wallet can't silently take over.
  clientEncEnabled: boolean("client_enc_enabled").default(false),
  clientEncEnrolledAt: timestamp("client_enc_enrolled_at"),
  clientKeyCanary: text("client_key_canary"),
  clientKeyAddr: text("client_key_addr"),
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
    // Mood trajectory: a per-entry emotional valence (-1..1) + one-word label, scored in the
    // background (null until scored, backfilled by the worker). Only a float + a word — nothing
    // new leaves the row.
    valence: real("valence"),
    valenceLabel: text("valence_label"),
    // Conversational capture: a composed "Daily Chat" entry carries an evocative title + topical
    // tags (also ride the 0G payload + a future timeline). Null for ordinary journal entries.
    title: text("title"),
    tags: jsonb("tags").$type<string[]>(),
    embedding: vector("embedding", { dimensions: EMBED_DIM }),
    kvRef: text("kv_ref"), // 0G KV pointer (source of truth)
    encScheme: text("enc_scheme"), // 'server' | 'client' — who holds the 0G blob's key (null = legacy)
    anchoredRoot: text("anchored_root"), // on-chain memory-root anchor
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("entries_user_idx").on(t.userId),
    index("entries_user_created_idx").on(t.userId, t.createdAt), // cheap mood-trend range scan
    index("entries_emb_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

// ── per-entry signals (powers the Omission Radar's absence statistic) ──
// One row per entry, populated incrementally at write time. Topics/valence/flatness let a real
// binomial zero-occurrence test name what the user has STOPPED mentioning — no re-tagging of history.
export const entrySignals = pgTable(
  "entry_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topics: jsonb("topics").$type<string[]>().notNull(), // normalized lowercase life-domain labels
    valence: real("valence"), // -1..1
    arousal: real("arousal"), // 0..1
    flat: boolean("flat").default(false), // affectively muted/numb read
    entryAt: timestamp("entry_at").notNull(), // copied from entries.created_at — no join for date math
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("entry_signals_entry_uniq").on(t.entryId),
    index("entry_signals_user_at_idx").on(t.userId, t.entryAt),
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
    // Hierarchical consolidation: period-start (YYYY-MM-DD) + supersede-not-delete bookkeeping so a
    // re-roll keeps the old essence as immutable history (and its on-chain anchor stays valid).
    period: text("period"),
    supersededAt: timestamp("superseded_at"),
    supersededBy: uuid("superseded_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userThreadIdx: index("reflection_artifacts_user_thread_idx").on(t.userId, t.threadKey),
    periodIdx: index("reflection_artifacts_period_idx").on(t.userId, t.threadKey, t.period),
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

// ── web-push subscriptions (the outbound retention channel) ──
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(), // client public key (for payload encryption)
    auth: text("auth").notNull(), // client auth secret
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uniq").on(t.endpoint)],
);

// ── eval runs (release gate) ─────────────────────────────
export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  suite: text("suite").notNull(),
  passed: boolean("passed"),
  score: real("score"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
