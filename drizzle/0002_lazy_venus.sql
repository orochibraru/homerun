CREATE TABLE "git_connection" ("access_token_enc" text NOT NULL, "created_at" timestamp NOT NULL, "expires_at"
  timestamp, "id" text PRIMARY KEY NOT NULL, "provider_id" text NOT NULL, "provider_kind" text NOT NULL,
  "provider_username" text NOT NULL, "refresh_token_enc" text, "updated_at" timestamp NOT NULL, "user_id" text NOT
  NULL);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "git_providers" jsonb DEFAULT '[]'::jsonb NOT NULL; --> statement-breakpoint
ALTER TABLE "git_connection" ADD CONSTRAINT "git_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES
  "public"."user"("id") ON DELETE cascade ON UPDATE no action; --> statement-breakpoint
CREATE UNIQUE INDEX "gitConnection_userId_providerId_uidx" ON "git_connection" USING btree ("user_id","provider_id");
