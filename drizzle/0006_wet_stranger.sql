ALTER TABLE `project` ADD `slug` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE UNIQUE INDEX `project_slug_unique` ON `project` (`slug`);
