CREATE TABLE "package_registry" (
	"created_at" timestamp NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"kind" text PRIMARY KEY NOT NULL,
	"public_host" text,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "package_registry_public_host_unique" UNIQUE("public_host")
);
--> statement-breakpoint
CREATE TABLE "package_registry_token" (
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"secret_hash" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_log" ALTER COLUMN "service_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_relay_host" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_relay_password_enc" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_relay_port" integer;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_relay_user" text;--> statement-breakpoint
ALTER TABLE "mail_mailbox" ADD COLUMN "kind" text DEFAULT 'mailbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_mailbox" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "webhook_error" text;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "webhook_id" text;--> statement-breakpoint
ALTER TABLE "service_log" ADD COLUMN "system" text;--> statement-breakpoint
ALTER TABLE "service_log" ADD COLUMN "workstation_id" text;--> statement-breakpoint
ALTER TABLE "package_registry_token" ADD CONSTRAINT "package_registry_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "packageRegistryToken_userId_idx" ON "package_registry_token" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "packageRegistryToken_kind_username_uidx" ON "package_registry_token" USING btree ("kind","username");--> statement-breakpoint
ALTER TABLE "mail_mailbox" ADD CONSTRAINT "mail_mailbox_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_log" ADD CONSTRAINT "service_log_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serviceLog_workstationId_time_idx" ON "service_log" USING btree ("workstation_id","time");--> statement-breakpoint
CREATE INDEX "serviceLog_system_time_idx" ON "service_log" USING btree ("system","time");