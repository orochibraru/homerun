CREATE TABLE "user_preferences" (
	"accent_color" text,
	"created_at" timestamp NOT NULL,
	"sidebar_color_intensity" text DEFAULT 'colorful' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;