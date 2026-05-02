CREATE TABLE `generated_images` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`storyboard_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`generation_request_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`checksum` text NOT NULL,
	`adopted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storyboard_id`) REFERENCES `storyboards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generation_request_id`) REFERENCES `generation_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `generated_images_project_id_idx` ON `generated_images` (`project_id`);--> statement-breakpoint
CREATE INDEX `generated_images_storyboard_id_idx` ON `generated_images` (`storyboard_id`);--> statement-breakpoint
CREATE INDEX `generated_images_scene_id_idx` ON `generated_images` (`scene_id`);--> statement-breakpoint
CREATE INDEX `generated_images_generation_request_id_idx` ON `generated_images` (`generation_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generated_images_one_adopted_idx` ON `generated_images` (`scene_id`) WHERE "generated_images"."adopted_at" is not null;--> statement-breakpoint
CREATE TABLE `generation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`storyboard_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`error_message` text,
	`source_generation_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storyboard_id`) REFERENCES `storyboards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `generation_requests_project_id_idx` ON `generation_requests` (`project_id`);--> statement-breakpoint
CREATE INDEX `generation_requests_storyboard_id_idx` ON `generation_requests` (`storyboard_id`);--> statement-breakpoint
CREATE INDEX `generation_requests_scene_id_idx` ON `generation_requests` (`scene_id`);--> statement-breakpoint
CREATE INDEX `generation_requests_status_idx` ON `generation_requests` (`status`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `photo_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`usage` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`checksum` text NOT NULL,
	`source_kind` text NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `photo_assets_project_id_idx` ON `photo_assets` (`project_id`);--> statement-breakpoint
CREATE INDEX `photo_assets_checksum_idx` ON `photo_assets` (`checksum`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `projects_organization_id_idx` ON `projects` (`organization_id`);--> statement-breakpoint
CREATE INDEX `projects_owner_user_id_idx` ON `projects` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `scene_photo_assets` (
	`scene_id` text NOT NULL,
	`photo_asset_id` text NOT NULL,
	`role` text NOT NULL,
	`order_index` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`photo_asset_id`) REFERENCES `photo_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scene_photo_assets_scene_photo_unique` ON `scene_photo_assets` (`scene_id`,`photo_asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `scene_photo_assets_one_primary_idx` ON `scene_photo_assets` (`scene_id`) WHERE "scene_photo_assets"."role" = 'primary';--> statement-breakpoint
CREATE INDEX `scene_photo_assets_photo_asset_id_idx` ON `scene_photo_assets` (`photo_asset_id`);--> statement-breakpoint
CREATE INDEX `scene_photo_assets_order_idx` ON `scene_photo_assets` (`scene_id`,`order_index`,`photo_asset_id`);--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`storyboard_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`image_prompt` text NOT NULL,
	`emotion` text NOT NULL,
	`camera_direction` text NOT NULL,
	`lighting_direction` text NOT NULL,
	`motion_direction` text NOT NULL,
	`notes` text NOT NULL,
	`adopted_generated_image_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storyboard_id`) REFERENCES `storyboards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scenes_project_id_idx` ON `scenes` (`project_id`);--> statement-breakpoint
CREATE INDEX `scenes_storyboard_id_idx` ON `scenes` (`storyboard_id`);--> statement-breakpoint
CREATE INDEX `scenes_order_idx` ON `scenes` (`storyboard_id`,`order_index`,`id`);--> statement-breakpoint
CREATE TABLE `storyboards` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`tone` text NOT NULL,
	`style_preset_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`style_preset_id`) REFERENCES `style_presets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `storyboards_project_id_idx` ON `storyboards` (`project_id`);--> statement-breakpoint
CREATE INDEX `storyboards_style_preset_id_idx` ON `storyboards` (`style_preset_id`);--> statement-breakpoint
CREATE TABLE `style_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`prompt` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `users_organization_id_idx` ON `users` (`organization_id`);