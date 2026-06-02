ALTER TABLE `scenes` ADD `kind` text DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE `scenes` ADD `bridge_from_scene_id` text;--> statement-breakpoint
ALTER TABLE `scenes` ADD `bridge_to_scene_id` text;