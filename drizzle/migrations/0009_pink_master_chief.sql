ALTER TABLE `scenes` ADD `negative_prompt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `storyboards` ADD `negative_prompt` text DEFAULT '' NOT NULL;