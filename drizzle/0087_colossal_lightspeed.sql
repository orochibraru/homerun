CREATE TABLE "resource_incident" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"last_notified_at" timestamp NOT NULL,
	"level" text NOT NULL,
	"notifications" integer DEFAULT 1 NOT NULL,
	"peak_percent" integer NOT NULL,
	"resolved_at" timestamp,
	"started_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "resource_alert_reminder_minutes" integer;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "resource_alert_sustain_seconds" integer;--> statement-breakpoint
CREATE INDEX "resourceIncident_startedAt_idx" ON "resource_incident" USING btree ("started_at");