ALTER TABLE `storage_volume` ADD `backup_access_key_id` text;--> statement-breakpoint
ALTER TABLE `storage_volume` ADD `backup_bucket` text;--> statement-breakpoint
ALTER TABLE `storage_volume` ADD `backup_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `storage_volume` ADD `backup_endpoint` text;--> statement-breakpoint
ALTER TABLE `storage_volume` ADD `backup_last_run_at` integer;--> statement-breakpoint
ALTER TABLE `storage_volume` ADD `backup_prefix` text;--> statement-breakpoint
ALTER TABLE `storage_volume` ADD `backup_region` text;--> statement-breakpoint
ALTER TABLE `storage_volume` ADD `backup_schedule` text;--> statement-breakpoint
ALTER TABLE `storage_volume` ADD `backup_secret_access_key_enc` text;