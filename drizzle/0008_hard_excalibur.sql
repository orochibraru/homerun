ALTER TABLE `service` ADD `custom_domain` text;--> statement-breakpoint
CREATE UNIQUE INDEX `service_custom_domain_unique` ON `service` (`custom_domain`);