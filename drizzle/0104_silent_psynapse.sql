CREATE TABLE "blocked_hit" (
	"created_at" timestamp NOT NULL,
	"host" text,
	"id" serial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"path" text
);
--> statement-breakpoint
CREATE TABLE "ip_ban" (
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"host" text,
	"ip" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "ip_bans" jsonb;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "auth_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "auth_paths_mode" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "blocked_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "blockedHit_ip_createdAt_idx" ON "blocked_hit" USING btree ("ip","created_at");