CREATE TABLE "uptime_check" (
	"checked_at" timestamp NOT NULL,
	"detail" text,
	"kind" text NOT NULL,
	"latency_ms" integer,
	"ok" boolean NOT NULL,
	"service_id" text NOT NULL,
	"target" text
);
--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "uptime_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "uptime_check" ADD CONSTRAINT "uptime_check_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uptimeCheck_serviceId_kind_uidx" ON "uptime_check" USING btree ("service_id","kind");