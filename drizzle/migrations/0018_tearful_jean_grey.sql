CREATE TABLE `mcp_tool_call_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`transport` text NOT NULL,
	`tool_name` text NOT NULL,
	`arguments_json` text NOT NULL,
	`outcome` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`change_proposal_id` text,
	`duration_ms` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mcp_tool_call_audits_project_id_idx` ON `mcp_tool_call_audits` (`project_id`);--> statement-breakpoint
CREATE INDEX `mcp_tool_call_audits_created_at_idx` ON `mcp_tool_call_audits` (`created_at`);