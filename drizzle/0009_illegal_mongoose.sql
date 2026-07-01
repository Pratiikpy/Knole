CREATE TABLE "entry_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"topics" jsonb NOT NULL,
	"valence" real,
	"arousal" real,
	"flat" boolean DEFAULT false,
	"entry_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry_signals" ADD CONSTRAINT "entry_signals_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_signals" ADD CONSTRAINT "entry_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entry_signals_entry_uniq" ON "entry_signals" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "entry_signals_user_at_idx" ON "entry_signals" USING btree ("user_id","entry_at");