ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "people_dimension_config" jsonb DEFAULT '{"columns":[],"profiledAt":null,"rowCount":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contributors" ADD COLUMN IF NOT EXISTS "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;
