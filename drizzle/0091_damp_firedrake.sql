CREATE TABLE "traffic_sample" (
	"bytes_in" double precision NOT NULL,
	"bytes_out" double precision NOT NULL,
	"created_at" timestamp NOT NULL,
	"duration_ms" double precision NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"requests" integer NOT NULL,
	"service_id" text NOT NULL,
	"status_4xx" integer NOT NULL,
	"status_5xx" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "traffic_sample" ADD CONSTRAINT "traffic_sample_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trafficSample_serviceId_createdAt_idx" ON "traffic_sample" USING btree ("service_id","created_at");