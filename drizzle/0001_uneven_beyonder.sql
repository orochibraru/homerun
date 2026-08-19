CREATE TABLE `project` (
	`created_at` integer NOT NULL,
	`description` text,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_userId_idx` ON `project` (`user_id`);--> statement-breakpoint
ALTER TABLE `service` ADD `project_id` text REFERENCES project(id);--> statement-breakpoint
CREATE INDEX `service_projectId_idx` ON `service` (`project_id`);