ALTER TABLE "project" RENAME TO "stack";--> statement-breakpoint
DO $$
DECLARE c record;
BEGIN
	FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'stack'::regclass AND conname LIKE 'project\_%' LOOP
		EXECUTE format('ALTER TABLE "stack" RENAME CONSTRAINT %I TO %I', c.conname, 'stack' || substr(c.conname, 8));
	END LOOP;
END $$;--> statement-breakpoint
ALTER INDEX "project_userId_idx" RENAME TO "stack_userId_idx";--> statement-breakpoint
ALTER TABLE "service" RENAME COLUMN "project_id" TO "stack_id";--> statement-breakpoint
ALTER TABLE "service" RENAME CONSTRAINT "service_project_id_project_id_fk" TO "service_stack_id_stack_id_fk";--> statement-breakpoint
ALTER INDEX "service_projectId_idx" RENAME TO "service_stackId_idx";--> statement-breakpoint
ALTER TABLE "status_page" RENAME COLUMN "project_id" TO "stack_id";--> statement-breakpoint
ALTER TABLE "status_page" RENAME CONSTRAINT "status_page_project_id_project_id_fk" TO "status_page_stack_id_stack_id_fk";--> statement-breakpoint
UPDATE "status_page" SET "scope" = 'stack' WHERE "scope" = 'project';
