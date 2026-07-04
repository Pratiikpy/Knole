CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" uuid,
	"reply_id" uuid,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"model" text NOT NULL,
	"sealed" boolean DEFAULT false NOT NULL,
	"leaf_hash" text NOT NULL,
	"anchored_root" text,
	"anchor_tx" text,
	"proof" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_user_idx" ON "receipts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "receipts_entry_idx" ON "receipts" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "receipts_unanchored_idx" ON "receipts" USING btree ("user_id","anchored_root");