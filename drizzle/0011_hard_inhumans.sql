ALTER TABLE `service` ADD `build_source` text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE `service` ADD `git_build_context` text;--> statement-breakpoint
ALTER TABLE `service` ADD `git_dockerfile_path` text;--> statement-breakpoint
ALTER TABLE `service` ADD `git_ref` text;--> statement-breakpoint
ALTER TABLE `service` ADD `git_url` text;