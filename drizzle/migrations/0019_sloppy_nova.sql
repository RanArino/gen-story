CREATE TABLE `agent_conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_id` text,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`mentions_json` text NOT NULL,
	`data_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_conversation_messages_sequence_unique` ON `agent_conversation_messages` (`conversation_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `agent_conversation_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`binding_id` text NOT NULL,
	`client_request_id` text NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`provider_turn_id` text,
	`compacted` integer NOT NULL,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`binding_id`) REFERENCES `agent_provider_bindings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_conversation_turns_conversation_id_idx` ON `agent_conversation_turns` (`conversation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_conversation_turns_client_request_unique` ON `agent_conversation_turns` (`conversation_id`,`client_request_id`);--> statement-breakpoint
CREATE TABLE `agent_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`active_binding_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_conversations_project_id_idx` ON `agent_conversations` (`project_id`);--> statement-breakpoint
CREATE TABLE `agent_provider_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`native_session_id` text,
	`status` text NOT NULL,
	`compact_count` integer NOT NULL,
	`last_compacted_at` text,
	`last_turn_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_provider_bindings_conversation_id_idx` ON `agent_provider_bindings` (`conversation_id`);