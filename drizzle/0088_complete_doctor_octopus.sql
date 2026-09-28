CREATE TABLE "dns_connection" (
	"created_at" timestamp NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dns_managed_record" (
	"content" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"domain_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"record_id" text NOT NULL,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain" (
	"auto_records" boolean DEFAULT true NOT NULL,
	"connection_id" text,
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"target" text,
	"user_id" text NOT NULL,
	"zone_id" text,
	"zone_name" text,
	CONSTRAINT "domain_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "dns_connection" ADD CONSTRAINT "dns_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_managed_record" ADD CONSTRAINT "dns_managed_record_domain_id_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_connection_id_dns_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."dns_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dnsManagedRecord_domain_name_type_uidx" ON "dns_managed_record" USING btree ("domain_id","name","type");--> statement-breakpoint
INSERT INTO "dns_connection" ("id", "name", "provider", "credentials", "user_id", "created_at", "updated_at")
SELECT 'migrated-cloudflare', 'Cloudflare', 'cloudflare', jsonb_build_object('apiToken', s."cloudflare_api_token_enc"), u."id", now(), now()
FROM "instance_settings" s
CROSS JOIN LATERAL (SELECT "id" FROM "user" ORDER BY ("role" = 'admin') DESC, "created_at" LIMIT 1) u
WHERE s."cloudflare_api_token_enc" IS NOT NULL AND s."cloudflare_zone_id" IS NOT NULL AND s."base_domain" IS NOT NULL
LIMIT 1;--> statement-breakpoint
INSERT INTO "domain" ("id", "name", "connection_id", "zone_id", "zone_name", "target", "auto_records", "user_id", "created_at")
SELECT 'migrated-base-domain', lower(s."base_domain"), c."id", s."cloudflare_zone_id", lower(s."base_domain"), lower(s."base_domain"), true, c."user_id", now()
FROM "instance_settings" s
JOIN "dns_connection" c ON c."id" = 'migrated-cloudflare'
LIMIT 1;--> statement-breakpoint
UPDATE "instance_settings" SET "dns_provider" = NULL WHERE "dns_provider" = 'cloudflare';--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN "cloudflare_api_token_enc";--> statement-breakpoint
ALTER TABLE "instance_settings" DROP COLUMN "cloudflare_zone_id";