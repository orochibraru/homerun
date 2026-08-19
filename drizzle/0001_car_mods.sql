CREATE TABLE `profile` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL UNIQUE,
	`username` text NOT NULL UNIQUE,
	`bio` text,
	`location` text,
	`cover_image` text,
	`is_public` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_userId_idx` ON `profile` (`user_id`);
--> statement-breakpoint

CREATE TABLE `car` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`make` text NOT NULL,
	`model` text NOT NULL,
	`year` integer NOT NULL,
	`trim` text,
	`color` text,
	`nickname` text,
	`description` text,
	`cover_image` text,
	`is_public` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `car_userId_idx` ON `car` (`user_id`);
--> statement-breakpoint
CREATE INDEX `car_isPublic_idx` ON `car` (`is_public`);
--> statement-breakpoint

CREATE TABLE `mod` (
	`id` text PRIMARY KEY NOT NULL,
	`car_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`brand` text,
	`part_number` text,
	`price` integer DEFAULT 0 NOT NULL,
	`labor_cost` integer DEFAULT 0 NOT NULL,
	`description` text,
	`install_date` integer,
	`status` text DEFAULT 'installed' NOT NULL,
	`is_public` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`car_id`) REFERENCES `car`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mod_carId_idx` ON `mod` (`car_id`);
--> statement-breakpoint
CREATE INDEX `mod_userId_idx` ON `mod` (`user_id`);
--> statement-breakpoint
CREATE INDEX `mod_category_idx` ON `mod` (`category`);
--> statement-breakpoint
CREATE INDEX `mod_status_idx` ON `mod` (`status`);
--> statement-breakpoint

CREATE TABLE `follow` (
	`id` text PRIMARY KEY NOT NULL,
	`follower_id` text NOT NULL,
	`following_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`follower_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`following_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `follow_followerId_idx` ON `follow` (`follower_id`);
--> statement-breakpoint
CREATE INDEX `follow_followingId_idx` ON `follow` (`following_id`);
--> statement-breakpoint

CREATE TABLE `like` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`car_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`car_id`) REFERENCES `car`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `like_userId_idx` ON `like` (`user_id`);
--> statement-breakpoint
CREATE INDEX `like_carId_idx` ON `like` (`car_id`);
--> statement-breakpoint

CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`car_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`car_id`) REFERENCES `car`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_userId_idx` ON `comment` (`user_id`);
--> statement-breakpoint
CREATE INDEX `comment_carId_idx` ON `comment` (`car_id`);
