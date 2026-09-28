ALTER TABLE "notification_channel" ALTER COLUMN "events" SET DEFAULT '["build.failed","build.checks_failed","update.failed","deploy.unhealthy","deploy.rolled_back","resource.warning","resource.critical","backup.failed","cron_job.failed"]'::jsonb;
--> statement-breakpoint
UPDATE "notification_channel" SET "events" = to_jsonb((("events" #>> '{}')::jsonb || '["backup.failed","cron_job.failed"]'::jsonb)::text) WHERE NOT (("events" #>> '{}')::jsonb @> '["backup.failed"]'::jsonb);
