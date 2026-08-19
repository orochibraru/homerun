CREATE TABLE `template` (
	`category` text,
	`container_port` integer NOT NULL,
	`cpu_limit` text,
	`created_at` integer NOT NULL,
	`description` text,
	`env_vars` text DEFAULT '{}',
	`icon` text,
	`id` text PRIMARY KEY NOT NULL,
	`image` text NOT NULL,
	`memory_limit_mb` integer,
	`name` text NOT NULL,
	`owner_id` text,
	`restart_policy` text DEFAULT 'unless-stopped' NOT NULL,
	`tag` text DEFAULT 'latest' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `template_ownerId_idx` ON `template` (`owner_id`);