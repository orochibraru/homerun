CREATE TABLE `invitation` (
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_token_unique` ON `invitation` (`token`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
ALTER TABLE `instance_settings` ADD `onboarding_completed_at` integer;