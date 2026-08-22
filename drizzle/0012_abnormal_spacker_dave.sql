ALTER TABLE "instance_settings" ADD COLUMN "orchestration_mode" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "replicas" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "swarm_service_id" text;