CREATE TABLE "job" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"dedupe_key" text,
	"depends_on_job_id" text,
	"error" text,
	"exclusive" boolean DEFAULT false NOT NULL,
	"finished_at" timestamp,
	"id" text PRIMARY KEY NOT NULL,
	"lock_key" text,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"run_at" timestamp NOT NULL,
	"service_id" text,
	"started_at" timestamp,
	"status" text DEFAULT 'queued' NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_status_runAt_idx" ON "job" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "job_userId_createdAt_idx" ON "job" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_type_dedupeKey_queued_uidx" ON "job" USING btree ("type","dedupe_key") WHERE "job"."status" = 'queued';