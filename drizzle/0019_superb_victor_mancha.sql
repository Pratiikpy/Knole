ALTER TABLE "memory_history" ADD COLUMN "leaf_hash" text;--> statement-breakpoint
ALTER TABLE "memory_history" ADD COLUMN "anchored_root" text;--> statement-breakpoint
ALTER TABLE "memory_history" ADD COLUMN "anchor_tx" text;--> statement-breakpoint
ALTER TABLE "memory_history" ADD COLUMN "proof" jsonb;