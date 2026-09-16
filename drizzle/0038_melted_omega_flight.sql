ALTER TABLE "notification_channel" ALTER COLUMN "events" SET DEFAULT '["build.failed","build.checks_failed","update.failed","deploy.unhealthy","deploy.rolled_back"]'::jsonb;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "build_source" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "health" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "image_id" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "rollback_of_deployment_id" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "auto_rollback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "require_status_checks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "required_status_checks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "notification_channel" SET "events" = "events" || '["build.checks_failed"]'::jsonb WHERE "events" @> '["build.failed"]'::jsonb AND NOT "events" @> '["build.checks_failed"]'::jsonb;--> statement-breakpoint
UPDATE "notification_channel" SET "events" = "events" || '["deploy.unhealthy","deploy.rolled_back"]'::jsonb WHERE "events" ?| array['build.failed','update.failed','deploy.failed'] AND NOT "events" @> '["deploy.rolled_back"]'::jsonb;--> statement-breakpoint
UPDATE "deployment" AS d SET "image_ref" = s."image" || ':' || s."tag", "build_source" = s."build_source" FROM "service" AS s WHERE d."service_id" = s."id" AND d."image_ref" IS NULL AND d."status" = 'running' AND d."id" = (SELECT d2."id" FROM "deployment" AS d2 WHERE d2."service_id" = s."id" AND d2."status" = 'running' ORDER BY d2."created_at" DESC LIMIT 1);
