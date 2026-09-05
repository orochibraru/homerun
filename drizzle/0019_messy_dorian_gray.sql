CREATE TABLE "cron_job" (
	"command" text,
	"created_at" timestamp NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"env_vars" jsonb DEFAULT '{}'::jsonb,
	"id" text PRIMARY KEY NOT NULL,
	"image" text,
	"kind" text NOT NULL,
	"last_run_at" timestamp,
	"name" text NOT NULL,
	"registry_password_enc" text,
	"registry_url" text,
	"registry_username" text,
	"schedule" text NOT NULL,
	"tag" text DEFAULT 'latest',
	"timeout_seconds" integer DEFAULT 900 NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_job_run" (
	"cron_job_id" text NOT NULL,
	"error" text,
	"exit_code" integer,
	"finished_at" timestamp,
	"id" text PRIMARY KEY NOT NULL,
	"output" text DEFAULT '',
	"started_at" timestamp NOT NULL,
	"success" boolean
);
--> statement-breakpoint
ALTER TABLE "cron_job" ADD CONSTRAINT "cron_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_job_run" ADD CONSTRAINT "cron_job_run_cron_job_id_cron_job_id_fk" FOREIGN KEY ("cron_job_id") REFERENCES "public"."cron_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cronJob_userId_idx" ON "cron_job" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cronJobRun_cronJobId_idx" ON "cron_job_run" USING btree ("cron_job_id");