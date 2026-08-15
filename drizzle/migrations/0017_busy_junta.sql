CREATE TABLE `change_proposal_choices` (
	`change_proposal_id` text NOT NULL,
	`target_item_id` text NOT NULL,
	`options_json` text NOT NULL,
	`selected_option_id` text,
	FOREIGN KEY (`change_proposal_id`) REFERENCES `change_proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_item_id`) REFERENCES `change_proposal_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `change_proposal_choices_target_item_unique` ON `change_proposal_choices` (`target_item_id`);--> statement-breakpoint
CREATE INDEX `change_proposal_choices_proposal_id_idx` ON `change_proposal_choices` (`change_proposal_id`);--> statement-breakpoint
CREATE TABLE `change_proposal_items` (
	`id` text PRIMARY KEY NOT NULL,
	`change_proposal_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text NOT NULL,
	`rationale` text NOT NULL,
	`base_revision` text NOT NULL,
	`approval` text NOT NULL,
	FOREIGN KEY (`change_proposal_id`) REFERENCES `change_proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `change_proposal_items_proposal_id_idx` ON `change_proposal_items` (`change_proposal_id`);--> statement-breakpoint
CREATE TABLE `change_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`rationale` text NOT NULL,
	`status` text NOT NULL,
	`client_request_id` text NOT NULL,
	`approved_by` text,
	`resolved_at` text,
	`apply_outcome_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `change_proposals_project_id_idx` ON `change_proposals` (`project_id`);--> statement-breakpoint
CREATE INDEX `change_proposals_project_status_idx` ON `change_proposals` (`project_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `change_proposals_project_client_request_unique` ON `change_proposals` (`project_id`,`client_request_id`);