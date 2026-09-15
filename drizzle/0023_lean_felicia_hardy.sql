CREATE TABLE "stat_sample" (
	"cpu_percent" double precision NOT NULL,
	"created_at" timestamp NOT NULL,
	"disk_used_gb" double precision,
	"id" text PRIMARY KEY NOT NULL,
	"mem_limit_mb" double precision,
	"mem_used_mb" double precision NOT NULL,
	"net_rx_bytes" double precision,
	"net_tx_bytes" double precision,
	"service_id" text
);
--> statement-breakpoint
ALTER TABLE "stat_sample" ADD CONSTRAINT "stat_sample_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statSample_serviceId_createdAt_idx" ON "stat_sample" USING btree ("service_id","created_at");