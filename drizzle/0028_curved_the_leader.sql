CREATE TABLE "couple_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"couple_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date_key" text NOT NULL,
	"question_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "couple_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"couple_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "couples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_code" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "couples_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
ALTER TABLE "couple_answers" ADD CONSTRAINT "couple_answers_couple_id_couples_id_fk" FOREIGN KEY ("couple_id") REFERENCES "public"."couples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "couple_answers" ADD CONSTRAINT "couple_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "couple_members" ADD CONSTRAINT "couple_members_couple_id_couples_id_fk" FOREIGN KEY ("couple_id") REFERENCES "public"."couples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "couple_members" ADD CONSTRAINT "couple_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "couple_answers_once" ON "couple_answers" USING btree ("couple_id","user_id","date_key");--> statement-breakpoint
CREATE INDEX "couple_answers_couple_date_idx" ON "couple_answers" USING btree ("couple_id","date_key");--> statement-breakpoint
CREATE UNIQUE INDEX "couple_members_user_uniq" ON "couple_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "couple_members_couple_idx" ON "couple_members" USING btree ("couple_id");