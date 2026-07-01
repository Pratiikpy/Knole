ALTER TYPE "public"."artifact_type" ADD VALUE 'weekly_essence' BEFORE 'monthly_essence';--> statement-breakpoint
ALTER TYPE "public"."artifact_type" ADD VALUE 'yearly_essence' BEFORE 'open_loop';--> statement-breakpoint
ALTER TABLE "reflection_artifacts" ADD COLUMN "period" text;--> statement-breakpoint
ALTER TABLE "reflection_artifacts" ADD COLUMN "superseded_at" timestamp;--> statement-breakpoint
ALTER TABLE "reflection_artifacts" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
CREATE INDEX "reflection_artifacts_period_idx" ON "reflection_artifacts" USING btree ("user_id","thread_key","period");