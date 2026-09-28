CREATE TABLE "node_enrollment" (
	"build_server" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"hostname" text,
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"remote_host_id" text,
	"swarm_node" boolean DEFAULT false NOT NULL,
	"token_hash" text NOT NULL,
	"used_at" timestamp,
	"user_id" text NOT NULL,
	CONSTRAINT "node_enrollment_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "node_enrollment" ADD CONSTRAINT "node_enrollment_remote_host_id_remote_host_id_fk" FOREIGN KEY ("remote_host_id") REFERENCES "public"."remote_host"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_enrollment" ADD CONSTRAINT "node_enrollment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;