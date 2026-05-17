CREATE TABLE `project_photo_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`emotion_candidates_json` text NOT NULL,
	`photo_insights_json` text NOT NULL,
	`story_summary` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_photo_analyses_project_id_unique` ON `project_photo_analyses` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_photo_analyses_project_id_idx` ON `project_photo_analyses` (`project_id`);
