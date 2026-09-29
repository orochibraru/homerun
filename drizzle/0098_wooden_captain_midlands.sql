CREATE TABLE "redirect" (
	"created_at" timestamp NOT NULL,
	"destination" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"keep_path" boolean DEFAULT true NOT NULL,
	"permanent" boolean DEFAULT true NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "redirect" ADD CONSTRAINT "redirect_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "redirect_source_idx" ON "redirect" USING btree ("source");--> statement-breakpoint
CREATE INDEX "redirect_userId_idx" ON "redirect" USING btree ("user_id");