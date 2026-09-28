CREATE TABLE "oauth_client_environment" (
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_localhost" boolean DEFAULT false NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_secret" (
	"client_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"environment_id" text,
	"expires_at" timestamp,
	"hint" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"last_used_at" timestamp,
	"secret_hash" text NOT NULL,
	CONSTRAINT "oauth_client_secret_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_client_environment" ADD CONSTRAINT "oauth_client_environment_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_secret" ADD CONSTRAINT "oauth_client_secret_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_secret" ADD CONSTRAINT "oauth_client_secret_environment_id_oauth_client_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."oauth_client_environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauthClientEnvironment_clientId_name_uidx" ON "oauth_client_environment" USING btree ("client_id","name");--> statement-breakpoint
CREATE INDEX "oauthClientSecret_clientId_idx" ON "oauth_client_secret" USING btree ("client_id");--> statement-breakpoint
INSERT INTO "oauth_client_environment" ("id", "client_id", "name", "redirect_uris", "allowed_origins", "allow_localhost", "created_at")
SELECT gen_random_uuid()::text, "client_id", 'production', COALESCE(NULLIF("redirect_uris", ''), '[]')::jsonb, '[]'::jsonb, false, now() FROM "oauth_client";--> statement-breakpoint
INSERT INTO "oauth_client_secret" ("id", "client_id", "environment_id", "label", "hint", "secret_hash", "created_at")
SELECT gen_random_uuid()::text, c."client_id", e."id", 'Original secret', '', c."client_secret", COALESCE(c."created_at", now())
FROM "oauth_client" c JOIN "oauth_client_environment" e ON e."client_id" = c."client_id"
WHERE c."client_secret" IS NOT NULL AND c."client_secret" NOT LIKE 'homerun-secrets:%';--> statement-breakpoint
UPDATE "oauth_client" SET "client_secret" = 'homerun-secrets:' || "client_id" WHERE "client_secret" IS NOT NULL;
