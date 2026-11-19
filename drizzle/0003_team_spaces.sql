CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer NOT NULL,
	`complimentary` integer DEFAULT false NOT NULL,
	`slot_assigned` integer DEFAULT false NOT NULL,
	`member_count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_ctl` (
	`id` integer PRIMARY KEY NOT NULL,
	`applying` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`space_id` text NOT NULL,
	`tbl` text NOT NULL,
	`cursor` text NOT NULL,
	PRIMARY KEY(`space_id`, `tbl`)
);
--> statement-breakpoint
CREATE TABLE `sync_tombstones` (
	`tbl` text NOT NULL,
	`id` text NOT NULL,
	`space_id` text NOT NULL,
	PRIMARY KEY(`tbl`, `id`)
);
--> statement-breakpoint
ALTER TABLE `game_events` ADD `dirty` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `game_roster` ADD `dirty` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `game_staff` ADD `dirty` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `space_id` text;--> statement-breakpoint
ALTER TABLE `games` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `games` ADD `dirty` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `period_checks` ADD `dirty` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `dirty` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `space_id` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `dirty` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
INSERT INTO `sync_ctl` (`id`, `applying`) VALUES (1, 0);
--> statement-breakpoint
CREATE TRIGGER `teams_mark_dirty` AFTER UPDATE ON `teams`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND NEW.`dirty` = OLD.`dirty`
BEGIN
	UPDATE `teams` SET `dirty` = 1 WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `players_mark_dirty` AFTER UPDATE ON `players`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND NEW.`dirty` = OLD.`dirty`
BEGIN
	UPDATE `players` SET `dirty` = 1 WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `games_mark_dirty` AFTER UPDATE ON `games`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND NEW.`dirty` = OLD.`dirty`
BEGIN
	UPDATE `games` SET `dirty` = 1 WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `game_roster_mark_dirty` AFTER UPDATE ON `game_roster`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND NEW.`dirty` = OLD.`dirty`
BEGIN
	UPDATE `game_roster` SET `dirty` = 1 WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `game_staff_mark_dirty` AFTER UPDATE ON `game_staff`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND NEW.`dirty` = OLD.`dirty`
BEGIN
	UPDATE `game_staff` SET `dirty` = 1 WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `game_events_mark_dirty` AFTER UPDATE ON `game_events`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND NEW.`dirty` = OLD.`dirty`
BEGIN
	UPDATE `game_events` SET `dirty` = 1 WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `period_checks_mark_dirty` AFTER UPDATE ON `period_checks`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND NEW.`dirty` = OLD.`dirty`
BEGIN
	UPDATE `period_checks` SET `dirty` = 1 WHERE rowid = NEW.rowid;
END;
--> statement-breakpoint
CREATE TRIGGER `teams_tombstone` BEFORE DELETE ON `teams`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND (OLD.`space_id`) IS NOT NULL
BEGIN
	INSERT OR REPLACE INTO `sync_tombstones` (`tbl`, `id`, `space_id`) VALUES ('squads', OLD.`id`, (OLD.`space_id`));
END;
--> statement-breakpoint
CREATE TRIGGER `players_tombstone` BEFORE DELETE ON `players`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND (SELECT `space_id` FROM `teams` WHERE `id` = OLD.`team_id`) IS NOT NULL
BEGIN
	INSERT OR REPLACE INTO `sync_tombstones` (`tbl`, `id`, `space_id`) VALUES ('squad_players', OLD.`id`, (SELECT `space_id` FROM `teams` WHERE `id` = OLD.`team_id`));
END;
--> statement-breakpoint
CREATE TRIGGER `games_tombstone` BEFORE DELETE ON `games`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND (OLD.`space_id`) IS NOT NULL
BEGIN
	INSERT OR REPLACE INTO `sync_tombstones` (`tbl`, `id`, `space_id`) VALUES ('games', OLD.`id`, (OLD.`space_id`));
END;
--> statement-breakpoint
CREATE TRIGGER `game_roster_tombstone` BEFORE DELETE ON `game_roster`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND (SELECT `space_id` FROM `games` WHERE `id` = OLD.`game_id`) IS NOT NULL
BEGIN
	INSERT OR REPLACE INTO `sync_tombstones` (`tbl`, `id`, `space_id`) VALUES ('game_roster', OLD.`id`, (SELECT `space_id` FROM `games` WHERE `id` = OLD.`game_id`));
END;
--> statement-breakpoint
CREATE TRIGGER `game_staff_tombstone` BEFORE DELETE ON `game_staff`
WHEN (SELECT `applying` FROM `sync_ctl` WHERE `id` = 1) = 0 AND (SELECT `space_id` FROM `games` WHERE `id` = OLD.`game_id`) IS NOT NULL
BEGIN
	INSERT OR REPLACE INTO `sync_tombstones` (`tbl`, `id`, `space_id`) VALUES ('game_staff', OLD.`id`, (SELECT `space_id` FROM `games` WHERE `id` = OLD.`game_id`));
END;
