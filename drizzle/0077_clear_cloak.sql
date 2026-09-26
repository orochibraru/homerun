CREATE TABLE "error_event" (
	"environment" text,
	"event_id" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"level" text DEFAULT 'error' NOT NULL,
	"message" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp NOT NULL,
	"release" text,
	"service_id" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"user_key" text
);
--> statement-breakpoint
CREATE TABLE "error_issue" (
	"count" integer DEFAULT 0 NOT NULL,
	"culprit" text,
	"fingerprint" text NOT NULL,
	"first_release" text,
	"first_seen" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"last_environment" text,
	"last_release" text,
	"last_seen" timestamp NOT NULL,
	"level" text DEFAULT 'error' NOT NULL,
	"platform" text,
	"regressed_at" timestamp,
	"resolved_at" timestamp,
	"service_id" text NOT NULL,
	"status" text DEFAULT 'unresolved' NOT NULL,
	"title" text NOT NULL,
	"type" text,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "error_project" (
	"created_at" timestamp NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"inject_env" boolean DEFAULT true NOT NULL,
	"internal_dsn" boolean DEFAULT true NOT NULL,
	"project_id" serial NOT NULL,
	"public_key" text NOT NULL,
	"service_id" text NOT NULL,
	CONSTRAINT "error_project_project_id_unique" UNIQUE("project_id"),
	CONSTRAINT "error_project_public_key_unique" UNIQUE("public_key"),
	CONSTRAINT "error_project_service_id_unique" UNIQUE("service_id")
);
--> statement-breakpoint
ALTER TABLE "error_event" ADD CONSTRAINT "error_event_issue_id_error_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."error_issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_event" ADD CONSTRAINT "error_event_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_issue" ADD CONSTRAINT "error_issue_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_project" ADD CONSTRAINT "error_project_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "errorEvent_serviceId_eventId_uidx" ON "error_event" USING btree ("service_id","event_id");--> statement-breakpoint
CREATE INDEX "errorEvent_issueId_receivedAt_idx" ON "error_event" USING btree ("issue_id","received_at");--> statement-breakpoint
CREATE INDEX "errorEvent_receivedAt_idx" ON "error_event" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "errorIssue_serviceId_fingerprint_uidx" ON "error_issue" USING btree ("service_id","fingerprint");--> statement-breakpoint
CREATE INDEX "errorIssue_serviceId_status_lastSeen_idx" ON "error_issue" USING btree ("service_id","status","last_seen");