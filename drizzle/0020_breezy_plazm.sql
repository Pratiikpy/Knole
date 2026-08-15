CREATE TABLE "nudge_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'random' NOT NULL,
	"window_start_min" integer DEFAULT 540 NOT NULL,
	"window_end_min" integer DEFAULT 1260 NOT NULL,
	"fixed_time_min" integer DEFAULT 1200 NOT NULL,
	"always_remind" boolean DEFAULT false NOT NULL,
	"otd_time_min" integer,
	"otd_last_date" text,
	"next_fire_at" timestamp,
	"last_fired_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nudge_settings" ADD CONSTRAINT "nudge_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;