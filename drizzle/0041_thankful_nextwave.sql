ALTER TABLE "image_scan" ADD COLUMN "fixable_counts" jsonb;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "image_scan_block_fixable_only" boolean;