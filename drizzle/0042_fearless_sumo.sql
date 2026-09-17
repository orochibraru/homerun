ALTER TABLE "backup_run" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "backup_run" ADD COLUMN "kind" text DEFAULT 'backup' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "config_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "restore_config" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "image_scan_required" boolean;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "retained_images_per_service" integer;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "cap_add" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "command" jsonb;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "devices" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "entrypoint" jsonb;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "env_files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "labels" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "privileged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "git_build_method" text DEFAULT 'dockerfile' NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "git_webhook_reconnect" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "git_poll_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "git_last_seen_commit" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "previews_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_parent_id" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_pr_number" integer;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_pr_title" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_branch" text;--> statement-breakpoint
ALTER TABLE "storage_volume" ADD COLUMN "backup_pre_command" text;--> statement-breakpoint
ALTER TABLE "storage_volume" ADD COLUMN "backup_pre_command_service_id" text;--> statement-breakpoint
ALTER TABLE "storage_volume" ADD COLUMN "backup_stop_services" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_preview_parent_id_service_id_fk" FOREIGN KEY ("preview_parent_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_volume" ADD CONSTRAINT "storage_volume_backup_pre_command_service_id_service_id_fk" FOREIGN KEY ("backup_pre_command_service_id") REFERENCES "public"."service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_previewParentId_previewPrNumber_uidx" ON "service" USING btree ("preview_parent_id","preview_pr_number");