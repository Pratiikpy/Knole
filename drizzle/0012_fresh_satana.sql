ALTER TABLE "entries" ADD COLUMN "enc_scheme" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "client_enc_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "client_enc_enrolled_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "client_key_canary" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "client_key_addr" text;