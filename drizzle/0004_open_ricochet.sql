CREATE TABLE `service_volume` (
	`container_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`read_only` integer DEFAULT false NOT NULL,
	`service_id` text NOT NULL,
	`volume_id` text NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`volume_id`) REFERENCES `storage_volume`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `serviceVolume_serviceId_idx` ON `service_volume` (`service_id`);--> statement-breakpoint
CREATE INDEX `serviceVolume_volumeId_idx` ON `service_volume` (`volume_id`);--> statement-breakpoint
CREATE TABLE `storage_volume` (
	`created_at` integer NOT NULL,
	`description` text,
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `storageVolume_userId_idx` ON `storage_volume` (`user_id`);