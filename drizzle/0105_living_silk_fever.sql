CREATE TABLE "iac_project" (
	"bucket" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"slug" text NOT NULL,
	"store_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "iac_project_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "iac_state_lock" (
	"created_at" timestamp NOT NULL,
	"info" jsonb,
	"lock_id" text NOT NULL,
	"project_id" text PRIMARY KEY NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "iac_state_version" (
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"lineage" text,
	"md5" text NOT NULL,
	"object_key" text NOT NULL,
	"project_id" text NOT NULL,
	"rollback_of_id" text,
	"serial" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "object_store" (
	"access_key_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"endpoint" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"secret_access_key_enc" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "garage_admin_token_enc" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "garage_enabled" boolean;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "garage_public_host" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "garage_rpc_secret_enc" text;--> statement-breakpoint
ALTER TABLE "iac_project" ADD CONSTRAINT "iac_project_store_id_object_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."object_store"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iac_project" ADD CONSTRAINT "iac_project_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iac_state_lock" ADD CONSTRAINT "iac_state_lock_project_id_iac_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."iac_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iac_state_lock" ADD CONSTRAINT "iac_state_lock_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iac_state_version" ADD CONSTRAINT "iac_state_version_project_id_iac_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."iac_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iac_state_version" ADD CONSTRAINT "iac_state_version_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_store" ADD CONSTRAINT "object_store_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "iacProject_storeId_idx" ON "iac_project" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "iacStateVersion_projectId_createdAt_idx" ON "iac_state_version" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "objectStore_userId_idx" ON "object_store" USING btree ("user_id");