ALTER TABLE "service" ADD COLUMN "preview_inherit_env" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_env_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_copy_volumes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_volume" ADD COLUMN "preview_service_id" text;--> statement-breakpoint
ALTER TABLE "storage_volume" ADD COLUMN "seed_from" text;--> statement-breakpoint
ALTER TABLE "storage_volume" ADD CONSTRAINT "storage_volume_preview_service_id_service_id_fk" FOREIGN KEY ("preview_service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;