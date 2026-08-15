CREATE TABLE "memory_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"embedding" vector(384),
	"memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mention_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_entities" ADD CONSTRAINT "memory_entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_entities_user_idx" ON "memory_entities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memory_entities_emb_idx" ON "memory_entities" USING hnsw ("embedding" vector_cosine_ops);