ALTER TABLE "service" ADD COLUMN "preview_domain_template" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "preview_default_domain" boolean DEFAULT true NOT NULL;