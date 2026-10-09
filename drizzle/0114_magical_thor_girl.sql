ALTER TABLE "iac_project" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "iac_project" ADD COLUMN "tool" text DEFAULT 'terraform' NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "git_watch_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "git_ignore_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;