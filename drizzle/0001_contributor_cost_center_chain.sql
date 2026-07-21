ALTER TABLE "contributors" ADD COLUMN IF NOT EXISTS "cost_center_chain" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contributors" ADD COLUMN IF NOT EXISTS "cost_center_path" text;
