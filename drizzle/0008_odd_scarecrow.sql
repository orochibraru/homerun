CREATE TABLE "build_cache_registry" (
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"password_enc" text NOT NULL,
	"registry_url" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "build_cache_registry_id" text;--> statement-breakpoint
ALTER TABLE "build_cache_registry" ADD CONSTRAINT "build_cache_registry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buildCacheRegistry_userId_idx" ON "build_cache_registry" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_build_cache_registry_id_build_cache_registry_id_fk" FOREIGN KEY ("build_cache_registry_id") REFERENCES "public"."build_cache_registry"("id") ON DELETE set null ON UPDATE no action;