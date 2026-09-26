ALTER TABLE "deployment" ADD COLUMN "trigger" text;--> statement-breakpoint
UPDATE "deployment" SET "trigger" = "job"."payload"->>'trigger' FROM "job" WHERE "job"."type" = 'deploy' AND "job"."payload"->>'deploymentId' = "deployment"."id" AND "job"."payload"->>'trigger' IN ('manual', 'cron', 'push');
