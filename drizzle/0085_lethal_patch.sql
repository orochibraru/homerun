CREATE TABLE "error_source_map" (
	"content" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"release" text NOT NULL,
	"service_id" text NOT NULL,
	"size_bytes" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "error_source_map" ADD CONSTRAINT "error_source_map_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "errorSourceMap_service_release_name_uidx" ON "error_source_map" USING btree ("service_id","release","name");