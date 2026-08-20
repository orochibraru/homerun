ALTER TABLE "service" ADD COLUMN "network_mode" text DEFAULT 'bridge' NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "port_protocol" text DEFAULT 'tcp' NOT NULL;