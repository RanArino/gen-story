PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`storyboard_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`status` text NOT NULL,
	`kind` text DEFAULT 'photo' NOT NULL,
	`bridge_from_scene_id` text,
	`bridge_to_scene_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`image_prompt` text NOT NULL,
	`emotion` text NOT NULL,
	`camera_direction` text NOT NULL,
	`lighting_direction` text NOT NULL,
	`motion_direction` text NOT NULL,
	`notes` text NOT NULL,
	`negative_prompt` text DEFAULT '' NOT NULL,
	`photo_fidelity` text DEFAULT 'high' NOT NULL,
	`adopted_generated_image_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storyboard_id`) REFERENCES `storyboards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scenes`("id", "project_id", "storyboard_id", "order_index", "status", "kind", "bridge_from_scene_id", "bridge_to_scene_id", "title", "description", "image_prompt", "emotion", "camera_direction", "lighting_direction", "motion_direction", "notes", "negative_prompt", "photo_fidelity", "adopted_generated_image_id", "created_at", "updated_at", "deleted_at") SELECT "id", "project_id", "storyboard_id", "order_index", "status", "kind", "bridge_from_scene_id", "bridge_to_scene_id", "title", "description", "image_prompt", "emotion", "camera_direction", "lighting_direction", "motion_direction", "notes", "negative_prompt", "photo_fidelity", "adopted_generated_image_id", "created_at", "updated_at", "deleted_at" FROM `scenes`;--> statement-breakpoint
DROP TABLE `scenes`;--> statement-breakpoint
ALTER TABLE `__new_scenes` RENAME TO `scenes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `scenes_project_id_idx` ON `scenes` (`project_id`);--> statement-breakpoint
CREATE INDEX `scenes_storyboard_id_idx` ON `scenes` (`storyboard_id`);--> statement-breakpoint
CREATE INDEX `scenes_order_idx` ON `scenes` (`storyboard_id`,`order_index`,`id`);