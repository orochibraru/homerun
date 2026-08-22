CREATE TABLE "s3_destination" (
	"access_key_id" text NOT NULL,
	"bucket" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"endpoint" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"secret_access_key_enc" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_volume" ADD COLUMN "s3_destination_id" text;--> statement-breakpoint
ALTER TABLE "s3_destination" ADD CONSTRAINT "s3_destination_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "s3Destination_userId_idx" ON "s3_destination" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "storage_volume" ADD CONSTRAINT "storage_volume_s3_destination_id_s3_destination_id_fk" FOREIGN KEY ("s3_destination_id") REFERENCES "public"."s3_destination"("id") ON DELETE set null ON UPDATE no action;