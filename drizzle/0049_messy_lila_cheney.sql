ALTER TABLE "service" ADD COLUMN "default_domain_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "primary_domain" text;--> statement-breakpoint
UPDATE "service" SET "domains" = ARRAY["custom_domain"], "primary_domain" = "custom_domain" WHERE "custom_domain" IS NOT NULL;