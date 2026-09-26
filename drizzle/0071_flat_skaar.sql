ALTER TABLE "deployment" ADD COLUMN "environment" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "channels_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "channel_branch" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "channel_tag_pattern" text DEFAULT 'v*' NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "channel_canary_domain" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "channel_canary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "deployment" SET "environment" = 'preview' FROM "service" WHERE "deployment"."service_id" = "service"."id" AND "service"."preview_parent_id" IS NOT NULL;
