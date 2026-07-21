ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "forecast_config" jsonb DEFAULT '{"seatCostMonthlyUsd":null,"lockedPeriods":[]}'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "headcount_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"dimension_key" text NOT NULL,
	"dimension_value" text NOT NULL,
	"period_start" date NOT NULL,
	"planned_headcount" numeric(12, 2) NOT NULL,
	"source" text DEFAULT 'csv' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "headcount_plans" ADD CONSTRAINT "headcount_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "headcount_plans_org_dim_period" ON "headcount_plans" USING btree ("org_id","dimension_key","dimension_value","period_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "headcount_plans_org_dim" ON "headcount_plans" USING btree ("org_id","dimension_key");
