CREATE TABLE "mail_alias" (
	"created_at" timestamp NOT NULL,
	"destinations" jsonb NOT NULL,
	"domain_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"local_part" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_domain" (
	"created_at" timestamp NOT NULL,
	"dkim_private_key_enc" text NOT NULL,
	"dkim_public_key" text NOT NULL,
	"dkim_selector" text DEFAULT 'mail' NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "mail_mailbox" (
	"created_at" timestamp NOT NULL,
	"display_name" text,
	"domain_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"local_part" text NOT NULL,
	"password_hash" text NOT NULL,
	"quota_mb" integer,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_enabled" boolean;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mail_hostname" text;--> statement-breakpoint
ALTER TABLE "mail_alias" ADD CONSTRAINT "mail_alias_domain_id_mail_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_domain" ADD CONSTRAINT "mail_domain_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_mailbox" ADD CONSTRAINT "mail_mailbox_domain_id_mail_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domain"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_alias_address_idx" ON "mail_alias" USING btree ("domain_id","local_part");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_domain_name_idx" ON "mail_domain" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_mailbox_address_idx" ON "mail_mailbox" USING btree ("domain_id","local_part");