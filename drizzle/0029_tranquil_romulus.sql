CREATE TABLE "couple_mirrors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"couple_id" uuid NOT NULL,
	"week_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "couple_answers" ADD COLUMN "guess" text;--> statement-breakpoint
ALTER TABLE "couple_mirrors" ADD CONSTRAINT "couple_mirrors_couple_id_couples_id_fk" FOREIGN KEY ("couple_id") REFERENCES "public"."couples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "couple_mirrors_week_uniq" ON "couple_mirrors" USING btree ("couple_id","week_key");