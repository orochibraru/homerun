CREATE TABLE "registry_token" (
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"last_used_at" timestamp,
	"secret_hash" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	CONSTRAINT "registry_token_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "registry_auth_enabled" boolean;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "registry_internal_secret_enc" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "registry_public_host" text;--> statement-breakpoint
ALTER TABLE "registry_token" ADD CONSTRAINT "registry_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registryToken_userId_idx" ON "registry_token" USING btree ("user_id");