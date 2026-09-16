CREATE TABLE "image_scan" (
	"counts" jsonb NOT NULL,
	"deployment_id" text,
	"digest" text,
	"error" text,
	"findings" jsonb NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"image_ref" text NOT NULL,
	"scanned_at" timestamp NOT NULL,
	"service_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"total_findings" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "image_scan_block_severity" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "image_scan_enabled" boolean;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "image_scan_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "image_scan" ADD CONSTRAINT "image_scan_deployment_id_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_scan" ADD CONSTRAINT "image_scan_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imageScan_serviceId_scannedAt_idx" ON "image_scan" USING btree ("service_id","scanned_at");