ALTER TABLE "instance_settings" DROP CONSTRAINT "instance_settings_autoscale_overflow_remote_host_id_remote_host_id_fk";
--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN "autoscale_cpu_threshold_percent";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN "autoscale_enabled";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN "autoscale_memory_threshold_percent";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN "autoscale_overflow_remote_host_id";--> statement-breakpoint
ALTER TABLE "service" DROP COLUMN "autoscale_eligible";