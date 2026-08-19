CREATE TABLE `remote_host` (
	`created_at` integer NOT NULL,
	`docker_host` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tls_ca_enc` text,
	`tls_cert_enc` text,
	`tls_key_enc` text,
	`updated_at` integer NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `remoteHost_userId_idx` ON `remote_host` (`user_id`);--> statement-breakpoint
ALTER TABLE `service` ADD `remote_host_id` text REFERENCES remote_host(id);