CREATE TABLE "tasks" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"due_date" text,
	"amount" jsonb,
	"details" text DEFAULT '' NOT NULL,
	"source_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tasks_user_id_idx" ON "tasks" ("user_id");