CREATE TABLE "backup_run" (
	"error" text,
	"finished_at" timestamp,
	"id" text PRIMARY KEY NOT NULL,
	"size_bytes" integer,
	"started_at" timestamp NOT NULL,
	"success" boolean,
	"volume_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_run" ADD CONSTRAINT "backup_run_volume_id_storage_volume_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."storage_volume"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backupRun_volumeId_idx" ON "backup_run" USING btree ("volume_id");