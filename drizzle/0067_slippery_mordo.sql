CREATE TABLE "service_dependency" (
	"created_at" timestamp NOT NULL,
	"depends_on_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "healthcheck_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "healthcheck_interval_seconds" integer;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "healthcheck_retries" integer;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "healthcheck_start_period_seconds" integer;--> statement-breakpoint
ALTER TABLE "service" ADD COLUMN "healthcheck_timeout_seconds" integer;--> statement-breakpoint
ALTER TABLE "service_dependency" ADD CONSTRAINT "service_dependency_depends_on_id_service_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_dependency" ADD CONSTRAINT "service_dependency_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "serviceDependency_pair_idx" ON "service_dependency" USING btree ("service_id","depends_on_id");--> statement-breakpoint
CREATE INDEX "serviceDependency_dependsOnId_idx" ON "service_dependency" USING btree ("depends_on_id");