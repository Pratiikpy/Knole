ALTER TABLE "entries" ADD COLUMN "valence" real;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "valence_label" text;--> statement-breakpoint
CREATE INDEX "entries_user_created_idx" ON "entries" USING btree ("user_id","created_at");