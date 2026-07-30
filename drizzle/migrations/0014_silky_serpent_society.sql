ALTER TABLE `generation_requests` ADD `test_generation_batch_id` text;--> statement-breakpoint
CREATE INDEX `generation_requests_test_generation_batch_id_idx` ON `generation_requests` (`test_generation_batch_id`);--> statement-breakpoint
-- Existing test variants recorded their batch in input_json only. Guarded on
-- null so re-running can never overwrite a value written after the backfill;
-- rows that were never test variants have no testBatchId and stay null.
UPDATE `generation_requests`
  SET `test_generation_batch_id` = json_extract(`input_json`, '$.testBatchId')
  WHERE `test_generation_batch_id` IS NULL;