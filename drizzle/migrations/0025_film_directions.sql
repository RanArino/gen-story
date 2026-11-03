CREATE TABLE `film_directions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`document` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `film_directions_project_id_idx` ON `film_directions` (`project_id`);