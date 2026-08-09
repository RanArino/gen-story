ALTER TABLE `storyboards` ADD `setup_completed_at` text;--> statement-breakpoint
-- Grandfather every storyboard that existed before the guided setup flow: they
-- keep today's free editing instead of being forced back through five steps.
-- Nothing in the data distinguishes "made before this feature" from "new and
-- unfinished", so the backfill is the only place that distinction can be drawn.
-- Guarded on null so re-running can never overwrite a real completion stamp.
UPDATE `storyboards` SET `setup_completed_at` = `updated_at` WHERE `setup_completed_at` IS NULL;
