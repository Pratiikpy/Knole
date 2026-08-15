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
  // Pay-as-you-go credits (Part 7C) — power metered breadth (image gen, general assistant) for users
  // who aren't on the subscription. Topped up via a Stripe one-time pack or pay-with-0G; never negative.
  credits: integer("credits").default(0).notNull(),
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
    // Structured check-in (#33): a user-selected energy level (0..1) alongside mood. Activities the
    // person logs ride the `tags` array below (unified with #35 tags), so they're correlatable for free.
    energy: real("energy"),
    // Personal-baseline flag (the baseline-app model): the person marks a check-in as below / at /
    // above THEIR usual. Days flagged unusual are down-weighted (x0.4) when computing the rolling
    // baseline, so the "normal" line tracks their normal, not their outliers.
    moodRel: text("mood_rel"),
    // Conversational capture: a composed "Daily Chat" entry carries an evocative title + topical
    // tags (also ride the 0G payload + a future timeline). Null for ordinary journal entries.
    title: text("title"),
    tags: jsonb("tags").$type<string[]>(),
    embedding: vector("embedding", { dimensions: EMBED_DIM }),
    kvRef: text("kv_ref"), // 0G KV pointer (source of truth)
    encScheme: text("enc_scheme"), // 'server' | 'client' — who holds the 0G blob's key (null = legacy)
    anchoredRoot: text("anchored_root"), // on-chain memory-root anchor
    // Soft delete (#35): a deleted entry drops out of every list + recall but stays recoverable for
    // 30 days (journalers fear losing entries — durability is trust). Purged after the window.
    deletedAt: timestamp("deleted_at"),
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
    // mem0 V3 linking: ids of existing memories this one relates to (same person, same thread,
    // a transition from a prior state). Written at extraction time from int-handle references.
    linkedIds: jsonb("linked_ids"),
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
    // Tamper-evident recall (#12): each audit row gets a leaf hash; leaves are Merkle-batched and the
    // root is anchored on 0G Chain, so any later alteration of the memory's history is detectable.
    leafHash: text("leaf_hash"),
    anchoredRoot: text("anchored_root"),
    anchorTx: text("anchor_tx"),
    proof: jsonb("proof").$type<string[]>(),
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

// ── program enrollments (guided journaling programs #30) ──
// A person's place in a guided program. The catalog itself is app content (server/programs.ts); this
// only tracks progress. One row per (user, program) — restarting a program resets it in place.
export const programEnrollments = pgTable(
  "program_enrollments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    programId: text("program_id").notNull(), // matches a Program.id in the catalog
    currentDay: integer("current_day").default(0).notNull(), // 0-indexed next day to write
    status: text("status").default("active").notNull(), // active | completed | abandoned
    startedAt: timestamp("started_at").defaultNow().notNull(),
    lastEntryAt: timestamp("last_entry_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    uniqueIndex("program_enrollments_user_program_uniq").on(t.userId, t.programId),
    index("program_enrollments_user_idx").on(t.userId),
  ],
);

// ── reflection receipts (#8) ─────────────────────────────
// A tamper-evident receipt for every reflection: a hash of (input, output, model, sealed flag,
// time). Leaves are batched into a Merkle tree whose root is anchored on 0G Chain; each receipt keeps
// its proof so anyone can recompute the leaf, verify the path to the anchored root, and see the tx.
export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").references(() => entries.id, { onDelete: "set null" }),
    replyId: uuid("reply_id"),
    inputHash: text("input_hash").notNull(), // sha256 of the reflected-on text
    outputHash: text("output_hash").notNull(), // sha256 of the reflection
    model: text("model").notNull(),
    sealed: boolean("sealed").default(false).notNull(), // ran inside the 0G TEE
    leafHash: text("leaf_hash").notNull(), // keccak256(input|output|model|sealed|ts)
    anchoredRoot: text("anchored_root"), // the Merkle root once anchored
    anchorTx: text("anchor_tx"), // on-chain tx that wrote the root
    proof: jsonb("proof").$type<string[]>(), // sibling hashes, leaf → root
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("receipts_user_idx").on(t.userId),
    index("receipts_entry_idx").on(t.entryId),
    index("receipts_unanchored_idx").on(t.userId, t.anchoredRoot),
  ],
);

// ── intentions (evidence-quoted goals #31) ───────────────
// What the person is working toward, in their own words. Movement is measured from their entries and
// shown WITH a quoted line — never a punishing streak. Max ~3 active (enforced in the engine).
export const intentions = pgTable(
  "intentions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    status: text("status").default("active").notNull(), // active | achieved | released
    source: text("source").default("user").notNull(), // user | suggested (AI-proposed, accepted)
    embedding: vector("embedding", { dimensions: EMBED_DIM }), // to match relevant entries
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("intentions_user_idx").on(t.userId)],
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

// ── nudge engine (the retention lever) ───────────────────
// One row per user: a randomized-in-window (or fixed) daily reminder that fires ONLY when they
// haven't journaled today, plus a memory-gated on-this-day push. next_fire_at is the precomputed
// UTC instant the dispatcher acts on; every fire schedules the next.
export const nudgeSettings = pgTable("nudge_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(false).notNull(),
  mode: text("mode").default("random").notNull(), // random (in window) | fixed
  windowStartMin: integer("window_start_min").default(540).notNull(), // 09:00, minutes from local midnight
  windowEndMin: integer("window_end_min").default(1260).notNull(), // 21:00; end < start = crosses midnight
  fixedTimeMin: integer("fixed_time_min").default(1200).notNull(), // 20:00
  alwaysRemind: boolean("always_remind").default(false).notNull(), // fire even after journaling
  otdTimeMin: integer("otd_time_min"), // on-this-day push, local minutes; null = off
  otdLastDate: text("otd_last_date"), // YYYY-MM-DD (user tz) of the last on-this-day push
  nextFireAt: timestamp("next_fire_at"),
  lastFiredAt: timestamp("last_fired_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── proactive automations (the khoj loop) ────────────────
// A saved question the journal asks itself on a schedule: NL instruction → cron + query + subject
// (LLM-translated), the runner re-asks the query through the normal ask pipeline (RAG for free),
// an LLM judge decides notify-or-not, and delivery rides push (+ email when configured).
export const automations = pgTable(
  "automations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instruction: text("instruction").notNull(), // the user's own words, kept verbatim
    query: text("query").notNull(), // what gets asked of the journal each run
    subject: text("subject").notNull(), // notification title
    crontab: text("crontab").notNull(), // standard 5-field cron, evaluated in the user's timezone
    active: boolean("active").default(true).notNull(),
    nextRunAt: timestamp("next_run_at"),
    lastRunAt: timestamp("last_run_at"),
    lastResult: text("last_result"), // truncated last answer (surfaced in settings)
    lastNotified: boolean("last_notified"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("automations_user_idx").on(t.userId), index("automations_due_idx").on(t.nextRunAt)],
);

// ── companion comments (the memex persona) ───────────────
// A second, smaller voice that sometimes leaves 1-2 in-character sentences under a reflection.
// The persona may SKIP (most ordinary entries get silence - that's the anti-slop rule working);
// when it speaks, the row records which single "move" it made so tone stays auditable.
export const entryComments = pgTable(
  "entry_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    persona: text("persona").default("margin").notNull(),
    move: text("move"), // witness | protect | tease | celebrate | sit-with | poetic-echo | practical-nudge | safety-boundary
    text: text("text").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("entry_comments_entry_uniq").on(t.entryId)],
);

// ── entity store (mem0) ──────────────────────────────────
// One row per distinct person/place/project a user's memories mention. Near-duplicate names merge
// at write time (>=0.95 name-embedding cosine), and retrieval uses entities as a third arm: a
// query that resembles an entity pulls in that entity's memories with a crowd-damped boost.
export const memoryEntities = pgTable(
  "memory_entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    embedding: vector("embedding", { dimensions: EMBED_DIM }),
    memoryIds: jsonb("memory_ids").$type<string[]>().default([]).notNull(),
    mentionCount: integer("mention_count").default(1).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("memory_entities_user_idx").on(t.userId),
    index("memory_entities_emb_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);
