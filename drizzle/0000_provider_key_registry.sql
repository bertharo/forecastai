CREATE TABLE "ai_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tool_key" text NOT NULL,
	"contributor_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"use_case" text DEFAULT 'unknown' NOT NULL,
	"tokens" numeric(20, 2) DEFAULT '0',
	"spend" numeric(18, 6) DEFAULT '0',
	"pr_external_id" text
);
--> statement-breakpoint
CREATE TABLE "ai_tool_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"day" date NOT NULL,
	"tool_key" text NOT NULL,
	"contributor_key" text DEFAULT 'unattributed' NOT NULL,
	"contributor_id" uuid,
	"dimension_node_id" uuid,
	"spend" numeric(18, 6) DEFAULT '0' NOT NULL,
	"tokens_in" numeric(20, 2) DEFAULT '0' NOT NULL,
	"tokens_out" numeric(20, 2) DEFAULT '0' NOT NULL,
	"tokens_total" numeric(20, 2) DEFAULT '0' NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"source_connector" text DEFAULT 'manual' NOT NULL,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "ai_tool_source_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tool_key" text NOT NULL,
	"primary_source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocation_rule_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"events_touched" integer DEFAULT 0 NOT NULL,
	"allocated_pct_before" numeric(6, 4),
	"allocated_pct_after" numeric(6, 4),
	"applied_by" text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"match" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"set" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text DEFAULT 'system' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"threshold_pct" numeric(6, 4) NOT NULL,
	"projected_breach_date" date,
	"message" text NOT NULL,
	"policy_action" text,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "budget_status_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"dimension_node_id" uuid,
	"feature_key" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"policy_action" text,
	"remaining" numeric(14, 2) DEFAULT '0' NOT NULL,
	"spent" numeric(14, 2) DEFAULT '0' NOT NULL,
	"projected_p50" numeric(14, 2),
	"breach_date" date,
	"period_end" date,
	"recommended_model" text,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"scope_type" text DEFAULT 'org' NOT NULL,
	"dimension_type_id" uuid,
	"dimension_node_id" uuid,
	"feature_key" text,
	"include_descendants" boolean DEFAULT true NOT NULL,
	"thresholds" jsonb DEFAULT '[0.5,0.8,1]'::jsonb NOT NULL,
	"policy" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"author" text DEFAULT 'system' NOT NULL,
	"change_note" text NOT NULL,
	"reallocation_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"scope_type" text DEFAULT 'org' NOT NULL,
	"dimension_type_id" uuid,
	"dimension_node_id" uuid,
	"feature_key" text,
	"include_descendants" boolean DEFAULT true NOT NULL,
	"thresholds" jsonb DEFAULT '[0.5,0.8,1]'::jsonb NOT NULL,
	"alert_channels" jsonb DEFAULT '{}'::jsonb,
	"parent_budget_id" uuid,
	"current_version_id" uuid
);
--> statement-breakpoint
CREATE TABLE "commitment_drawdowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commitment_id" uuid NOT NULL,
	"cost_record_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount_applied" numeric(18, 6) NOT NULL,
	"remaining_balance" numeric(18, 6)
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"provider_id" uuid NOT NULL,
	"amount_usd" numeric(14, 2),
	"unit" text DEFAULT 'USD' NOT NULL,
	"capacity_amount" numeric(20, 4),
	"term_start" timestamp with time zone NOT NULL,
	"term_end" timestamp with time zone NOT NULL,
	"applicable_sku_ids" jsonb DEFAULT '[]'::jsonb,
	"applicable_meter_ids" jsonb DEFAULT '[]'::jsonb,
	"drawdown_method" text DEFAULT 'fifo' NOT NULL,
	"utilization_target_pct" numeric(6, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "connector_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"phase" text NOT NULL,
	"rows_in" integer DEFAULT 0,
	"rows_written" integer DEFAULT 0,
	"errors" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"tier" integer NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"auth_config" jsonb DEFAULT '{}'::jsonb,
	"credentials_encrypted" text,
	"credentials_key_id" text,
	"sync_cursor" jsonb DEFAULT '{}'::jsonb,
	"demo_mode" boolean DEFAULT false NOT NULL,
	"stale_after_hours" integer DEFAULT 24 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"backfill_progress_pct" numeric(6, 2) DEFAULT '0',
	"spend_covered_pct" numeric(6, 2),
	"allocated_pct" numeric(6, 2),
	"allocated_by_dimension" jsonb DEFAULT '{}'::jsonb,
	"mapping_template_id" uuid,
	"health_message" text
);
--> statement-breakpoint
CREATE TABLE "contributor_team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contributor_id" uuid NOT NULL,
	"dimension_node_id" uuid NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"github_login" text,
	"github_id" text,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dimension_node_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_record_dimensions" (
	"cost_record_id" uuid NOT NULL,
	"dimension_type_id" uuid NOT NULL,
	"dimension_node_id" uuid NOT NULL,
	CONSTRAINT "cost_record_dimensions_cost_record_id_dimension_type_id_pk" PRIMARY KEY("cost_record_id","dimension_type_id")
);
--> statement-breakpoint
CREATE TABLE "cost_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"usage_event_id" uuid,
	"usage_daily_id" uuid,
	"charge_period_start" timestamp with time zone NOT NULL,
	"charge_period_end" timestamp with time zone NOT NULL,
	"provider_id" uuid NOT NULL,
	"sku_id" uuid,
	"meter_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"focus_sku_id" text,
	"consumed_quantity" numeric(24, 6) NOT NULL,
	"consumed_unit" text NOT NULL,
	"billed_cost" numeric(18, 6) NOT NULL,
	"effective_cost" numeric(18, 6) NOT NULL,
	"list_unit_price" numeric(18, 10),
	"effective_unit_price" numeric(18, 10),
	"price_card_id" uuid,
	"price_card_line_id" uuid,
	"commitment_id" uuid,
	"commitment_savings" numeric(18, 6) DEFAULT '0',
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allocation_status" text DEFAULT 'allocated' NOT NULL,
	"import_batch_id" uuid,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "dimension_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"dimension_type_id" uuid NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"parent_id" uuid,
	"path" text NOT NULL,
	"external_id" text,
	"cost_center_code" text,
	"owner_email" text,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "dimension_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"is_hierarchical" boolean DEFAULT true NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"value" numeric(20, 8) NOT NULL,
	"source" text DEFAULT 'actual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"unit" text NOT NULL,
	"parent_id" uuid,
	"feature_key" text,
	"formula" text DEFAULT 'leaf' NOT NULL,
	"is_fitted" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"scope_dimension_node_id" uuid
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"file_name" text NOT NULL,
	"content_hash" text NOT NULL,
	"mapping_template_id" uuid,
	"status" text DEFAULT 'previewing' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"rows_errored" integer DEFAULT 0 NOT NULL,
	"error_report" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text DEFAULT 'demo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mapping_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"provider_id" uuid,
	"name" text NOT NULL,
	"source_format" text DEFAULT 'usage_export' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"column_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sample_headers" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"scoped_dimension_node_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"meter_key" text NOT NULL,
	"display_name" text NOT NULL,
	"consumed_unit" text NOT NULL,
	"category" text NOT NULL,
	"pricing_model" text DEFAULT 'per_unit' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"access_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "otel_ingest_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text DEFAULT 'meter_' NOT NULL,
	"label" text NOT NULL,
	"env_tag" text DEFAULT 'prod' NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by" text DEFAULT 'system' NOT NULL,
	"rotated_from_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "price_card_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_card_id" uuid NOT NULL,
	"sku_id" uuid,
	"meter_id" uuid NOT NULL,
	"unit_price" numeric(18, 10) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"tier_min" numeric(20, 6),
	"tier_max" numeric(20, 6),
	"discount_pct" numeric(6, 4),
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "price_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"source" text DEFAULT 'published' NOT NULL,
	"parent_card_id" uuid,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "provider_key_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text,
	"dimension_node_id" uuid,
	"is_service_account" boolean DEFAULT false NOT NULL,
	"service_label" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"connector_tier" integer DEFAULT 4 NOT NULL,
	"connector_status" text DEFAULT 'stub' NOT NULL,
	"estimated_spend_share" numeric(6, 4),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "providers_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"scm_connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"author_contributor_id" uuid,
	"author_login" text,
	"merged_at" timestamp with time zone,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"ai_assisted" boolean
);
--> statement-breakpoint
CREATE TABLE "scenario_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"override_type" text NOT NULL,
	"target_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"day" date NOT NULL,
	"grain" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"p10_cost" numeric(18, 6) NOT NULL,
	"p50_cost" numeric(18, 6) NOT NULL,
	"p90_cost" numeric(18, 6) NOT NULL,
	"driver_snapshot" jsonb DEFAULT '{}'::jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"horizon_months" integer DEFAULT 12 NOT NULL,
	"baseline_scenario_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scm_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"account_login" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"credentials_encrypted" text,
	"credentials_key_id" text,
	"selected_repos" jsonb DEFAULT '[]'::jsonb,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seat_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"seats_purchased" integer NOT NULL,
	"seats_active" integer NOT NULL,
	"seats_heavy" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"sku_id" text NOT NULL,
	"display_name" text NOT NULL,
	"family" text,
	"modality" text DEFAULT 'chat' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"day" date NOT NULL,
	"provider_id" uuid NOT NULL,
	"sku_id" uuid,
	"meter_id" uuid NOT NULL,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags_hash" text DEFAULT '' NOT NULL,
	"quantity_sum" numeric(24, 6) NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"latency_p50" integer,
	"latency_p95" integer
);
--> statement-breakpoint
CREATE TABLE "usage_event_dimensions" (
	"usage_event_id" uuid NOT NULL,
	"dimension_type_id" uuid NOT NULL,
	"dimension_node_id" uuid NOT NULL,
	CONSTRAINT "usage_event_dimensions_usage_event_id_dimension_type_id_pk" PRIMARY KEY("usage_event_id","dimension_type_id")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"provider_id" uuid NOT NULL,
	"sku_id" uuid,
	"meter_id" uuid NOT NULL,
	"consumed_quantity" numeric(20, 6) NOT NULL,
	"consumed_unit" text NOT NULL,
	"request_id" text,
	"latency_ms" integer,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connector_id" uuid,
	"import_batch_id" uuid,
	"content_hash" text,
	"charge_period_start" timestamp with time zone,
	"charge_period_end" timestamp with time zone,
	"allocation_status" text DEFAULT 'allocated' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"email_verified" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "value_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"value_metric_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_batch_id" uuid,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "value_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"unit_key" text NOT NULL,
	"display_name" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"otel_tag_key" text,
	"dollar_per_unit" numeric(14, 4),
	"owning_dimension_node_id" uuid
);
--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_daily" ADD CONSTRAINT "ai_tool_daily_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_daily" ADD CONSTRAINT "ai_tool_daily_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_daily" ADD CONSTRAINT "ai_tool_daily_dimension_node_id_dimension_nodes_id_fk" FOREIGN KEY ("dimension_node_id") REFERENCES "public"."dimension_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_source_prefs" ADD CONSTRAINT "ai_tool_source_prefs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rule_applications" ADD CONSTRAINT "allocation_rule_applications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rule_applications" ADD CONSTRAINT "allocation_rule_applications_rule_id_allocation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."allocation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_status_snapshots" ADD CONSTRAINT "budget_status_snapshots_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_status_snapshots" ADD CONSTRAINT "budget_status_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_dimension_type_id_dimension_types_id_fk" FOREIGN KEY ("dimension_type_id") REFERENCES "public"."dimension_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_dimension_node_id_dimension_nodes_id_fk" FOREIGN KEY ("dimension_node_id") REFERENCES "public"."dimension_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_drawdowns" ADD CONSTRAINT "commitment_drawdowns_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_drawdowns" ADD CONSTRAINT "commitment_drawdowns_cost_record_id_cost_records_id_fk" FOREIGN KEY ("cost_record_id") REFERENCES "public"."cost_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_sync_runs" ADD CONSTRAINT "connector_sync_runs_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_mapping_template_id_mapping_templates_id_fk" FOREIGN KEY ("mapping_template_id") REFERENCES "public"."mapping_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_team_memberships" ADD CONSTRAINT "contributor_team_memberships_contributor_id_contributors_id_fk" FOREIGN KEY ("contributor_id") REFERENCES "public"."contributors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributor_team_memberships" ADD CONSTRAINT "contributor_team_memberships_dimension_node_id_dimension_nodes_id_fk" FOREIGN KEY ("dimension_node_id") REFERENCES "public"."dimension_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_dimension_node_id_dimension_nodes_id_fk" FOREIGN KEY ("dimension_node_id") REFERENCES "public"."dimension_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_record_dimensions" ADD CONSTRAINT "cost_record_dimensions_cost_record_id_cost_records_id_fk" FOREIGN KEY ("cost_record_id") REFERENCES "public"."cost_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_record_dimensions" ADD CONSTRAINT "cost_record_dimensions_dimension_type_id_dimension_types_id_fk" FOREIGN KEY ("dimension_type_id") REFERENCES "public"."dimension_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_record_dimensions" ADD CONSTRAINT "cost_record_dimensions_dimension_node_id_dimension_nodes_id_fk" FOREIGN KEY ("dimension_node_id") REFERENCES "public"."dimension_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_usage_event_id_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."usage_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_usage_daily_id_usage_daily_id_fk" FOREIGN KEY ("usage_daily_id") REFERENCES "public"."usage_daily"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_price_card_id_price_cards_id_fk" FOREIGN KEY ("price_card_id") REFERENCES "public"."price_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_price_card_line_id_price_card_lines_id_fk" FOREIGN KEY ("price_card_line_id") REFERENCES "public"."price_card_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_nodes" ADD CONSTRAINT "dimension_nodes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_nodes" ADD CONSTRAINT "dimension_nodes_dimension_type_id_dimension_types_id_fk" FOREIGN KEY ("dimension_type_id") REFERENCES "public"."dimension_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dimension_types" ADD CONSTRAINT "dimension_types_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_values" ADD CONSTRAINT "driver_values_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_scope_dimension_node_id_dimension_nodes_id_fk" FOREIGN KEY ("scope_dimension_node_id") REFERENCES "public"."dimension_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_mapping_template_id_mapping_templates_id_fk" FOREIGN KEY ("mapping_template_id") REFERENCES "public"."mapping_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_scoped_dimension_node_id_dimension_nodes_id_fk" FOREIGN KEY ("scoped_dimension_node_id") REFERENCES "public"."dimension_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_webhooks" ADD CONSTRAINT "org_webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otel_ingest_keys" ADD CONSTRAINT "otel_ingest_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_card_lines" ADD CONSTRAINT "price_card_lines_price_card_id_price_cards_id_fk" FOREIGN KEY ("price_card_id") REFERENCES "public"."price_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_card_lines" ADD CONSTRAINT "price_card_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_card_lines" ADD CONSTRAINT "price_card_lines_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_cards" ADD CONSTRAINT "price_cards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_cards" ADD CONSTRAINT "price_cards_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_key_registry" ADD CONSTRAINT "provider_key_registry_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_key_registry" ADD CONSTRAINT "provider_key_registry_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_key_registry" ADD CONSTRAINT "provider_key_registry_dimension_node_id_dimension_nodes_id_fk" FOREIGN KEY ("dimension_node_id") REFERENCES "public"."dimension_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_scm_connection_id_scm_connections_id_fk" FOREIGN KEY ("scm_connection_id") REFERENCES "public"."scm_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_author_contributor_id_contributors_id_fk" FOREIGN KEY ("author_contributor_id") REFERENCES "public"."contributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_overrides" ADD CONSTRAINT "scenario_overrides_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_results" ADD CONSTRAINT "scenario_results_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_connections" ADD CONSTRAINT "scm_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_snapshots" ADD CONSTRAINT "seat_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_snapshots" ADD CONSTRAINT "seat_snapshots_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event_dimensions" ADD CONSTRAINT "usage_event_dimensions_usage_event_id_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."usage_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event_dimensions" ADD CONSTRAINT "usage_event_dimensions_dimension_type_id_dimension_types_id_fk" FOREIGN KEY ("dimension_type_id") REFERENCES "public"."dimension_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event_dimensions" ADD CONSTRAINT "usage_event_dimensions_dimension_node_id_dimension_nodes_id_fk" FOREIGN KEY ("dimension_node_id") REFERENCES "public"."dimension_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_events" ADD CONSTRAINT "value_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_events" ADD CONSTRAINT "value_events_value_metric_id_value_metrics_id_fk" FOREIGN KEY ("value_metric_id") REFERENCES "public"."value_metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_metrics" ADD CONSTRAINT "value_metrics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_metrics" ADD CONSTRAINT "value_metrics_owning_dimension_node_id_dimension_nodes_id_fk" FOREIGN KEY ("owning_dimension_node_id") REFERENCES "public"."dimension_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_sessions_org_started" ON "ai_sessions" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tool_daily_grain" ON "ai_tool_daily" USING btree ("org_id","day","tool_key","contributor_key");--> statement-breakpoint
CREATE INDEX "ai_tool_daily_org_day" ON "ai_tool_daily" USING btree ("org_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tool_source_prefs_org_tool" ON "ai_tool_source_prefs" USING btree ("org_id","tool_key");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created" ON "audit_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_status_budget" ON "budget_status_snapshots" USING btree ("budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_versions_budget_version" ON "budget_versions" USING btree ("budget_id","version");--> statement-breakpoint
CREATE INDEX "budget_versions_effective_idx" ON "budget_versions" USING btree ("budget_id","effective_from");--> statement-breakpoint
CREATE INDEX "contributor_team_contrib" ON "contributor_team_memberships" USING btree ("contributor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_org_email" ON "contributors" USING btree ("org_id","email");--> statement-breakpoint
CREATE INDEX "contributors_org_github" ON "contributors" USING btree ("org_id","github_login");--> statement-breakpoint
CREATE INDEX "cost_records_org_period_idx" ON "cost_records" USING btree ("org_id","charge_period_start");--> statement-breakpoint
CREATE INDEX "cost_records_provider_idx" ON "cost_records" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "cost_records_batch_idx" ON "cost_records" USING btree ("import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_records_org_content_hash" ON "cost_records" USING btree ("org_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "dimension_nodes_type_key" ON "dimension_nodes" USING btree ("dimension_type_id","key");--> statement-breakpoint
CREATE INDEX "dimension_nodes_path_idx" ON "dimension_nodes" USING btree ("path");--> statement-breakpoint
CREATE INDEX "dimension_nodes_parent_idx" ON "dimension_nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dimension_types_org_key" ON "dimension_types" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "driver_values_driver_period" ON "driver_values" USING btree ("driver_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_org_key_feature" ON "drivers" USING btree ("org_id","key","feature_key");--> statement-breakpoint
CREATE INDEX "import_batches_org_hash_idx" ON "import_batches" USING btree ("org_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meters_provider_key" ON "meters" USING btree ("provider_id","meter_key");--> statement-breakpoint
CREATE INDEX "notifications_org_created" ON "notifications" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "otel_keys_org_hash" ON "otel_ingest_keys" USING btree ("org_id","key_hash");--> statement-breakpoint
CREATE INDEX "price_card_lines_card_idx" ON "price_card_lines" USING btree ("price_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_key_registry_org_prov_kind_ext" ON "provider_key_registry" USING btree ("org_id","provider_id","kind","external_id");--> statement-breakpoint
CREATE INDEX "provider_key_registry_org_unmapped" ON "provider_key_registry" USING btree ("org_id","dimension_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_conn_repo_num" ON "pull_requests" USING btree ("scm_connection_id","repo","number");--> statement-breakpoint
CREATE INDEX "pull_requests_org_merged" ON "pull_requests" USING btree ("org_id","merged_at");--> statement-breakpoint
CREATE INDEX "scenario_results_scenario_day" ON "scenario_results" USING btree ("scenario_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "scm_connections_org_provider" ON "scm_connections" USING btree ("org_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_snapshots_org_provider_day" ON "seat_snapshots" USING btree ("org_id","provider_id","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "skus_provider_sku" ON "skus" USING btree ("provider_id","sku_id");--> statement-breakpoint
CREATE INDEX "usage_daily_org_day_idx" ON "usage_daily" USING btree ("org_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_daily_grain" ON "usage_daily" USING btree ("org_id","day","provider_id","sku_id","meter_id","tags_hash");--> statement-breakpoint
CREATE INDEX "usage_events_org_time_idx" ON "usage_events" USING btree ("org_id","event_time");--> statement-breakpoint
CREATE INDEX "usage_events_provider_idx" ON "usage_events" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "usage_events_sku_idx" ON "usage_events" USING btree ("sku_id");--> statement-breakpoint
CREATE INDEX "usage_events_meter_idx" ON "usage_events" USING btree ("meter_id");--> statement-breakpoint
CREATE INDEX "usage_events_batch_idx" ON "usage_events" USING btree ("import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_org_content_hash" ON "usage_events" USING btree ("org_id","content_hash");--> statement-breakpoint
CREATE INDEX "value_events_metric_period" ON "value_events" USING btree ("value_metric_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "value_metrics_org_feature_unit" ON "value_metrics" USING btree ("org_id","feature_key","unit_key");