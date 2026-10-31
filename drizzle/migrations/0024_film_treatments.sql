CREATE TABLE `film_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`created_at` text NOT NULL,
	`document` text NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `film_jobs_project_id_idx` ON `film_jobs` (`project_id`);--> statement-breakpoint
CREATE TABLE `film_treatments` (
	`project_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`document` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `scenes` ADD `original_image_selected` integer DEFAULT false NOT NULL;