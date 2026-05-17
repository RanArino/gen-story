CREATE TABLE `test_generation_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`storyboard_id` text NOT NULL,
	`status` text NOT NULL,
	`confirmed_generation_request_id` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`storyboard_id`) REFERENCES `storyboards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_generation_request_id`) REFERENCES `generation_requests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `test_generation_batches_storyboard_id_idx` ON `test_generation_batches` (`storyboard_id`);
