ALTER TABLE "remote_host" ALTER COLUMN "docker_host" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "remote_host" ADD COLUMN "agent_token_enc" text;--> statement-breakpoint
ALTER TABLE "remote_host" ADD COLUMN "agent_url" text;--> statement-breakpoint
ALTER TABLE "remote_host" ADD COLUMN "kind" text DEFAULT 'docker' NOT NULL;