ALTER TABLE "resource_incident" ADD COLUMN "remote_host_id" text;--> statement-breakpoint
ALTER TABLE "resource_incident" ADD COLUMN "samples" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_incident" ADD CONSTRAINT "resource_incident_remote_host_id_remote_host_id_fk" FOREIGN KEY ("remote_host_id") REFERENCES "public"."remote_host"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resourceIncident_remoteHostId_idx" ON "resource_incident" USING btree ("remote_host_id");