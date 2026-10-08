CREATE TABLE "public_bucket" (
	"bucket" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"store_id" text NOT NULL,
	CONSTRAINT "public_bucket_store_id_bucket_pk" PRIMARY KEY("store_id","bucket")
);
--> statement-breakpoint
ALTER TABLE "public_bucket" ADD CONSTRAINT "public_bucket_store_id_object_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."object_store"("id") ON DELETE cascade ON UPDATE no action;