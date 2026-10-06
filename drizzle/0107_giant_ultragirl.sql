ALTER TABLE "s3_destination" ADD COLUMN "capacity_alert_percent" integer DEFAULT 85 NOT NULL;--> statement-breakpoint
ALTER TABLE "s3_destination" ADD COLUMN "capacity_alerted_at" timestamp;--> statement-breakpoint
ALTER TABLE "s3_destination" ADD COLUMN "capacity_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "s3_destination" ADD COLUMN "capacity_error" text;--> statement-breakpoint
ALTER TABLE "s3_destination" ADD COLUMN "capacity_free_bytes" bigint;--> statement-breakpoint
ALTER TABLE "s3_destination" ADD COLUMN "capacity_total_bytes" bigint;--> statement-breakpoint
ALTER TABLE "s3_destination" ADD COLUMN "capacity_used_bytes" bigint;