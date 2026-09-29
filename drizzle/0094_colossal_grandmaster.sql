ALTER TABLE "instance_settings" ADD COLUMN "tls_cert_enc" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "tls_key_enc" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "tls_cert_names" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "tls_cert_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "tls_cert_issuer" text;