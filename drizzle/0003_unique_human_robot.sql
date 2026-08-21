ALTER TABLE "instance_settings" ADD COLUMN "autoscale_cpu_threshold_percent" integer DEFAULT 80 NOT
  NULL; --> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "autoscale_enabled" boolean DEFAULT false NOT NULL; --> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "autoscale_memory_threshold_percent" integer DEFAULT 80 NOT
  NULL; --> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "autoscale_overflow_remote_host_id" text; --> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "autoscale_eligible" boolean DEFAULT false NOT NULL; --> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_autoscale_overflow_remote_host_id_remote_host_id_fk"
  FOREIGN KEY ("autoscale_overflow_remote_host_id") REFERENCES "public"."remote_host"("id") ON DELETE set null ON UPDATE
  no action;
