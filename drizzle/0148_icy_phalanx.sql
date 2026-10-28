CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "service_log" (
	"deployment_id" text,
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"instance" text NOT NULL,
	"line" text NOT NULL,
	"service_id" text NOT NULL,
	"stream" text NOT NULL,
	"time" timestamp (6) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "log_retention_days" integer;--> statement-breakpoint
ALTER TABLE "service_log" ADD CONSTRAINT "service_log_deployment_id_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_log" ADD CONSTRAINT "service_log_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serviceLog_serviceId_time_idx" ON "service_log" USING btree ("service_id","time");--> statement-breakpoint
CREATE INDEX "serviceLog_deploymentId_idx" ON "service_log" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "serviceLog_time_idx" ON "service_log" USING btree ("time");--> statement-breakpoint
CREATE INDEX "serviceLog_line_trgm_idx" ON "service_log" USING gin ("line" gin_trgm_ops);