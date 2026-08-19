ALTER TABLE `service` ADD `cron_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `service` ADD `cron_last_run_at` integer;--> statement-breakpoint
ALTER TABLE `service` ADD `cron_schedule` text;