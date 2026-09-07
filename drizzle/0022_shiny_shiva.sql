ALTER TABLE "service" DROP CONSTRAINT "service_remote_host_id_remote_host_id_fk";
--> statement-breakpoint
ALTER TABLE "remote_host" DROP COLUMN "is_build_server";--> statement-breakpoint
ALTER TABLE "service" DROP COLUMN "remote_host_id";