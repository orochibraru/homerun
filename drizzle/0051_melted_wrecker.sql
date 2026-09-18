ALTER TABLE "job" ADD COLUMN "executor_error" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "executor_result" jsonb;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "heartbeat_at" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "log" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "spec" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "worker_id" text;--> statement-breakpoint
CREATE INDEX "job_status_stage_idx" ON "job" USING btree ("status","stage");