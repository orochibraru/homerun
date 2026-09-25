ALTER TABLE "instance_settings" ADD COLUMN "traefik_http_cache" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "http_cache_ttl" integer;