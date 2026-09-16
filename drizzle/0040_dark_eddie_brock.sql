ALTER TABLE "service" ADD COLUMN "git_provider_id" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "git_repo" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "auto_deploy_on_push" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "git_webhook_id" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "git_webhook_secret_enc" text;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "git_webhook_error" text;