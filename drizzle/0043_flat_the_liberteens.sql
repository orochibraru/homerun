ALTER TABLE "template" ADD COLUMN "cap_add" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "command" jsonb;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "devices" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "entrypoint" jsonb;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "env_files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "labels" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "privileged" boolean DEFAULT false NOT NULL;