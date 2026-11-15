CREATE TABLE `game_events` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`order_key` real NOT NULL,
	`period` integer NOT NULL,
	`side` text,
	`roster_id` text,
	`type` text NOT NULL,
	`foul_kind` text,
	`ft_awarded` integer,
	`created_at` integer NOT NULL,
	`voided_at` integer,
	`replaces_event_id` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `game_events_game_idx` ON `game_events` (`game_id`,`order_key`);--> statement-breakpoint
CREATE TABLE `game_roster` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`side` text NOT NULL,
	`player_id` text,
	`number` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`is_starter` integer DEFAULT false NOT NULL,
	`is_captain` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `game_roster_game_idx` ON `game_roster` (`game_id`);--> statement-breakpoint
CREATE TABLE `game_staff` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`side` text NOT NULL,
	`role` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `game_staff_game_idx` ON `game_staff` (`game_id`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`league_name` text DEFAULT '' NOT NULL,
	`venue` text DEFAULT '' NOT NULL,
	`own_side` text DEFAULT 'A' NOT NULL,
	`team_a_name` text DEFAULT '' NOT NULL,
	`team_b_name` text DEFAULT '' NOT NULL,
	`period_minutes` integer DEFAULT 10 NOT NULL,
	`ot_minutes` integer DEFAULT 5 NOT NULL,
	`status` text DEFAULT 'prep' NOT NULL,
	`current_period` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `period_checks` (
	`game_id` text NOT NULL,
	`period` integer NOT NULL,
	`score_a` integer NOT NULL,
	`score_b` integer NOT NULL,
	`team_fouls_a` integer NOT NULL,
	`team_fouls_b` integer NOT NULL,
	`matched` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`confirmed_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `period`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`number` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `players_team_idx` ON `players` (`team_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_own` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
