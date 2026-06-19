CREATE TYPE "public"."actor_type" AS ENUM('user', 'ai', 'system');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('daily_mirror', 'weekly_mirror', 'monthly_essence', 'open_loop', 'pattern', 'commitment', 'state');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('journal', 'chat', 'saved');--> statement-breakpoint
CREATE TYPE "public"."feedback_action" AS ENUM('helpful', 'wrong', 'too_much', 'creepy', 'save', 'forget');--> statement-breakpoint
CREATE TYPE "public"."memory_sector" AS ENUM('episodic', 'semantic', 'procedural', 'emotional', 'reflective');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('candidate', 'active', 'pinned', 'corrected', 'archived', 'forgotten', 'superseded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('fact', 'pattern', 'commitment', 'relationship', 'preference', 'value', 'emotion');--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "entry_type" DEFAULT 'journal' NOT NULL,
	"text" text NOT NULL,
	"mood" text,
	"embedding" vector(384),
	"kv_ref" text,
	"anchored_root" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite" text NOT NULL,
	"passed" boolean,
	"score" real,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_platform" text,
	"status" text DEFAULT 'pending',
	"raw_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"type" "memory_type" DEFAULT 'fact' NOT NULL,
	"sector" "memory_sector" DEFAULT 'episodic' NOT NULL,
	"status" "memory_status" DEFAULT 'candidate' NOT NULL,
	"confidence" real DEFAULT 0.5,
	"importance" real DEFAULT 0.5,
	"source_entry_id" uuid,
	"source_quote" text,
	"last_used_in_reply_id" uuid,
	"provenance" jsonb,
	"recall_count" integer DEFAULT 0,
	"distinct_query_count" integer DEFAULT 0,
	"distinct_day_count" integer DEFAULT 0,
	"last_recalled_at" timestamp,
	"embedding" vector(384),
	"valid_at" timestamp DEFAULT now(),
	"invalid_at" timestamp,
	"invalidated_by" uuid,
	"user_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"memory_id" uuid,
	"reply_id" uuid,
	"action" "feedback_action" NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"actor" "actor_type" DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reflection_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "artifact_type" NOT NULL,
	"thread_key" text,
	"content" jsonb NOT NULL,
	"sources" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_entry_id" uuid NOT NULL,
	"is_ai" boolean DEFAULT false NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_id" text,
	"email" text,
	"wallet_address" text,
	"kv_namespace" text,
	"timezone" text DEFAULT 'UTC',
	"plan" text DEFAULT 'free',
	"quiet_hours_start" integer DEFAULT 22,
	"quiet_hours_end" integer DEFAULT 8,
	"freq_dial" integer DEFAULT 3,
	"proactivity_paused" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_privy_id_unique" UNIQUE("privy_id")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_entry_id_entries_id_fk" FOREIGN KEY ("source_entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection_artifacts" ADD CONSTRAINT "reflection_artifacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_parent_entry_id_entries_id_fk" FOREIGN KEY ("parent_entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_user_idx" ON "entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entries_emb_idx" ON "entries" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "memories_user_idx" ON "memories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memories_user_hash_uniq" ON "memories" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX "memories_emb_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "replies_parent_idx" ON "replies" USING btree ("parent_entry_id");