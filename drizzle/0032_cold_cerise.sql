ALTER TABLE "notification_channel" DROP CONSTRAINT "notification_channel_status_page_id_status_page_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_channel" ADD COLUMN "events" jsonb DEFAULT '["build.failed","update.failed"]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "notification_channel" SET "events" = '["build.failed","update.failed","service.down","service.up"]'::jsonb;--> statement-breakpoint
ALTER TABLE "notification_channel" DROP COLUMN "status_page_id";