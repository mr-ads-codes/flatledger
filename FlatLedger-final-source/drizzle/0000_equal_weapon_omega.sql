CREATE TABLE `expense_participants` (
	`expense_id` text NOT NULL,
	`member_id` text NOT NULL,
	PRIMARY KEY(`expense_id`, `member_id`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`category` text NOT NULL,
	`paid_by` text NOT NULL,
	`expense_date` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`pin_hash` text NOT NULL,
	`color` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`from_member` text NOT NULL,
	`to_member` text NOT NULL,
	`amount` integer NOT NULL,
	`settlement_date` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
