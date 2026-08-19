CREATE TABLE `car_image` (
	`id` text PRIMARY KEY NOT NULL,
	`car_id` text NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`caption` text,
	`is_main` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`car_id`) REFERENCES `car`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `car_image_carId_idx` ON `car_image` (`car_id`);
--> statement-breakpoint
CREATE INDEX `car_image_userId_idx` ON `car_image` (`user_id`);
