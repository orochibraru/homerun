ALTER TABLE "workstation" ADD COLUMN "editor_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workstation" ADD COLUMN "extensions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workstation" ADD COLUMN "git_author_email" text;--> statement-breakpoint
ALTER TABLE "workstation" ADD COLUMN "git_author_name" text;--> statement-breakpoint
ALTER TABLE "workstation" ADD COLUMN "git_provider_id" text;