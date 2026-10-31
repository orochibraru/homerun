ALTER TABLE "user_preferences" ALTER COLUMN "surface_style" SET DEFAULT 'lanes';--> statement-breakpoint
UPDATE "user_preferences" SET "surface_style" = 'lanes' WHERE "preset" IS NULL;
