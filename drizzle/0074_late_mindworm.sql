ALTER TABLE "service" ADD COLUMN "preview_auth_allowed_groups" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_auth_allowed_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_auth_allowed_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_auth_providers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_auth_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "service" SET "preview_auth_required" = "auth_required", "preview_auth_providers" = "auth_providers", "preview_auth_allowed_user_ids" = "auth_allowed_user_ids", "preview_auth_allowed_emails" = "auth_allowed_emails", "preview_auth_allowed_groups" = "auth_allowed_groups" WHERE "preview_parent_id" IS NULL;
