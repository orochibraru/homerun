ALTER TABLE "deployment" ADD COLUMN "git_commit" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "git_ref" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "image_ref" text;