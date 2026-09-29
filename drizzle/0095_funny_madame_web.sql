ALTER TABLE "instance_settings" ADD COLUMN "ssh_private_key_enc" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "ssh_public_key" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "ssh_host" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "ssh_port" integer;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "ssh_user" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "ssh_host_key" text;--> statement-breakpoint
ALTER TABLE "remote_host" ADD COLUMN "ssh_host" text;--> statement-breakpoint
ALTER TABLE "remote_host" ADD COLUMN "ssh_port" integer;--> statement-breakpoint
ALTER TABLE "remote_host" ADD COLUMN "ssh_user" text;--> statement-breakpoint
ALTER TABLE "remote_host" ADD COLUMN "ssh_host_key" text;