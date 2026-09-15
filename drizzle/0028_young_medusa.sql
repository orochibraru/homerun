ALTER TABLE "service" ADD COLUMN "errors_dismissed_at" timestamp;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "errors_dismissed_by_deployment_id" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "pull_policy" text DEFAULT 'always' NOT NULL;