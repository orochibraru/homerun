CREATE TABLE "service_event" (
	"actor_id" text,
	"actor_name" text,
	"created_at" timestamp NOT NULL,
	"detail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"lane" text NOT NULL,
	"service_id" text NOT NULL,
	"summary" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_event" ADD CONSTRAINT "service_event_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serviceEvent_serviceId_createdAt_idx" ON "service_event" USING btree ("service_id","created_at");