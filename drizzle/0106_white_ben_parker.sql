CREATE TABLE "trace_span" (
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_ms" double precision NOT NULL,
	"end_time" timestamp (3) NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"kind" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"parent_span_id" text,
	"resource_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"service_id" text,
	"service_name" text NOT NULL,
	"span_id" text NOT NULL,
	"start_time" timestamp (3) NOT NULL,
	"status_code" integer DEFAULT 0 NOT NULL,
	"status_message" text,
	"trace_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "default_ui_mode" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "otel_collector_enabled" boolean;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "trace_retention_days" integer;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "traces_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "ui_mode" text;--> statement-breakpoint
ALTER TABLE "trace_span" ADD CONSTRAINT "trace_span_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "traceSpan_traceId_spanId_idx" ON "trace_span" USING btree ("trace_id","span_id");--> statement-breakpoint
CREATE INDEX "traceSpan_serviceId_startTime_idx" ON "trace_span" USING btree ("service_id","start_time");--> statement-breakpoint
CREATE INDEX "traceSpan_startTime_idx" ON "trace_span" USING btree ("start_time");