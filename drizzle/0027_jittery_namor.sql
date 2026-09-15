CREATE TABLE "notification_channel" (
	"created_at" timestamp NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"last_error" text,
	"name" text NOT NULL,
	"status_page_id" text,
	"target" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_page" (
	"created_at" timestamp NOT NULL,
	"description" text,
	"id" text PRIMARY KEY NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"project_id" text,
	"scope" text NOT NULL,
	"slug" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "status_page_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "status_page_service" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"status_page_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_status_page_id_status_page_id_fk" FOREIGN KEY ("status_page_id") REFERENCES "public"."status_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channel" ADD CONSTRAINT "notification_channel_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page" ADD CONSTRAINT "status_page_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page" ADD CONSTRAINT "status_page_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_service" ADD CONSTRAINT "status_page_service_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_page_service" ADD CONSTRAINT "status_page_service_status_page_id_status_page_id_fk" FOREIGN KEY ("status_page_id") REFERENCES "public"."status_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notificationChannel_userId_idx" ON "notification_channel" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "statusPage_userId_idx" ON "status_page" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statusPageService_pageId_serviceId_uidx" ON "status_page_service" USING btree ("status_page_id","service_id");--> statement-breakpoint
CREATE INDEX "statusPageService_serviceId_idx" ON "status_page_service" USING btree ("service_id");