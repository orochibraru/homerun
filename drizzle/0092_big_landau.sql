ALTER TABLE "user_preferences" ALTER COLUMN "surface_style" SET DEFAULT 'sleek';--> statement-breakpoint
UPDATE "user_preferences" SET "surface_style" = 'sleek' WHERE "surface_style" = 'glass';
