-- Probe results are a minute old at most and the table only existed for one
-- release, so the rows are cleared rather than backfilled with ids: adding a
-- NOT NULL primary key to a table with rows fails outright.
DELETE FROM "uptime_check";--> statement-breakpoint
DROP INDEX "uptimeCheck_serviceId_kind_uidx";--> statement-breakpoint
ALTER TABLE "uptime_check" ADD COLUMN "id" text PRIMARY KEY NOT NULL;--> statement-breakpoint
CREATE INDEX "uptimeCheck_serviceId_kind_checkedAt_idx" ON "uptime_check" USING btree ("service_id","kind","checked_at");