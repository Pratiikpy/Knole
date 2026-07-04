CREATE TABLE "program_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"program_id" text NOT NULL,
	"current_day" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_entry_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "program_enrollments" ADD CONSTRAINT "program_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "program_enrollments_user_program_uniq" ON "program_enrollments" USING btree ("user_id","program_id");--> statement-breakpoint
CREATE INDEX "program_enrollments_user_idx" ON "program_enrollments" USING btree ("user_id");