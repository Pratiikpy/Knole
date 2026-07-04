CREATE TABLE "intentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"embedding" vector(384),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intentions" ADD CONSTRAINT "intentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intentions_user_idx" ON "intentions" USING btree ("user_id");