import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Demo org + multi-tenant ready */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vendor catalog. connectorTier is upgradeable (4→1) without schema changes.
 * Tier: 1 native API, 2 billing export, 3 OTel/push, 4 invoice/seat reconciliation.
 */
export const providers = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  displayName: text("display_name").notNull(),
  connectorTier: integer("connector_tier").notNull().default(4),
  connectorStatus: text("connector_status").notNull().default("stub"), // stub|mock|live
  estimatedSpendShare: numeric("estimated_spend_share", { precision: 6, scale: 4 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});

/**
 * Canonical meter abstraction — not tokens-hardcoded.
 * FOCUS ConsumedUnit lives on consumedUnit.
 */
export const meters = pgTable(
  "meters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    meterKey: text("meter_key").notNull(), // input_tokens, seats, gpu_hours, …
    displayName: text("display_name").notNull(),
    consumedUnit: text("consumed_unit").notNull(), // Tokens | Seats | Hours | Credits | Requests
    category: text("category").notNull(), // usage | seat | credit | capacity
    pricingModel: text("pricing_model").notNull().default("per_unit"), // per_unit | tiered | included_then_overage
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (t) => [uniqueIndex("meters_provider_key").on(t.providerId, t.meterKey)]
);

export const skus = pgTable(
  "skus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    skuId: text("sku_id").notNull(), // FOCUS SkuId
    displayName: text("display_name").notNull(),
    family: text("family"),
    modality: text("modality").notNull().default("chat"), // chat|embedding|image|seat|credit
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (t) => [uniqueIndex("skus_provider_sku").on(t.providerId, t.skuId)]
);

/**
 * Org-defined slice taxonomy (cost_center, team, business_unit, …).
 * Not a global enum — each company configures its own dimensions.
 */
export const dimensionTypes = pgTable(
  "dimension_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    isHierarchical: boolean("is_hierarchical").notNull().default(true),
    isRequired: boolean("is_required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("dimension_types_org_key").on(t.orgId, t.key)]
);

export const dimensionNodes = pgTable(
  "dimension_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    dimensionTypeId: uuid("dimension_type_id")
      .notNull()
      .references(() => dimensionTypes.id),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    parentId: uuid("parent_id"),
    path: text("path").notNull(), // materialized path e.g. /product/platform/ai-platform
    externalId: text("external_id"),
    active: boolean("active").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (t) => [
    uniqueIndex("dimension_nodes_type_key").on(t.dimensionTypeId, t.key),
    index("dimension_nodes_path_idx").on(t.path),
    index("dimension_nodes_parent_idx").on(t.parentId),
  ]
);

/**
 * Atomic usage fact. Production: PARTITION BY RANGE (event_time) daily.
 * tags hold non-org attrs (feature, env, customer_id). Org slices → usage_event_dimensions.
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    skuId: uuid("sku_id").references(() => skus.id),
    meterId: uuid("meter_id")
      .notNull()
      .references(() => meters.id),
    consumedQuantity: numeric("consumed_quantity", { precision: 20, scale: 6 }).notNull(),
    consumedUnit: text("consumed_unit").notNull(),
    requestId: text("request_id"),
    latencyMs: integer("latency_ms"),
    tags: jsonb("tags").$type<Record<string, string>>().notNull().default({}),
    connectorId: uuid("connector_id"),
    chargePeriodStart: timestamp("charge_period_start", { withTimezone: true }),
    chargePeriodEnd: timestamp("charge_period_end", { withTimezone: true }),
    allocationStatus: text("allocation_status").notNull().default("allocated"), // allocated|unallocated
  },
  (t) => [
    index("usage_events_org_time_idx").on(t.orgId, t.eventTime),
    index("usage_events_provider_idx").on(t.providerId),
    index("usage_events_sku_idx").on(t.skuId),
    index("usage_events_meter_idx").on(t.meterId),
  ]
);

export const usageEventDimensions = pgTable(
  "usage_event_dimensions",
  {
    usageEventId: uuid("usage_event_id")
      .notNull()
      .references(() => usageEvents.id, { onDelete: "cascade" }),
    dimensionTypeId: uuid("dimension_type_id")
      .notNull()
      .references(() => dimensionTypes.id),
    dimensionNodeId: uuid("dimension_node_id")
      .notNull()
      .references(() => dimensionNodes.id),
  },
  (t) => [primaryKey({ columns: [t.usageEventId, t.dimensionTypeId] })]
);

export const usageDaily = pgTable(
  "usage_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    day: date("day").notNull(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    skuId: uuid("sku_id").references(() => skus.id),
    meterId: uuid("meter_id")
      .notNull()
      .references(() => meters.id),
    tags: jsonb("tags").$type<Record<string, string>>().notNull().default({}),
    tagsHash: text("tags_hash").notNull().default(""),
    quantitySum: numeric("quantity_sum", { precision: 24, scale: 6 }).notNull(),
    eventCount: integer("event_count").notNull().default(0),
    latencyP50: integer("latency_p50"),
    latencyP95: integer("latency_p95"),
  },
  (t) => [
    index("usage_daily_org_day_idx").on(t.orgId, t.day),
    uniqueIndex("usage_daily_grain").on(
      t.orgId,
      t.day,
      t.providerId,
      t.skuId,
      t.meterId,
      t.tagsHash
    ),
  ]
);

/** Versioned pricing — historical cost uses card in effect at event time */
export const priceCards = pgTable("price_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id), // NULL = public list catalog
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  source: text("source").notNull().default("published"), // published|negotiated|scenario
  parentCardId: uuid("parent_card_id"),
  notes: text("notes"),
});

export const priceCardLines = pgTable(
  "price_card_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceCardId: uuid("price_card_id")
      .notNull()
      .references(() => priceCards.id, { onDelete: "cascade" }),
    skuId: uuid("sku_id").references(() => skus.id),
    meterId: uuid("meter_id")
      .notNull()
      .references(() => meters.id),
    unitPrice: numeric("unit_price", { precision: 18, scale: 10 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    tierMin: numeric("tier_min", { precision: 20, scale: 6 }),
    tierMax: numeric("tier_max", { precision: 20, scale: 6 }),
    discountPct: numeric("discount_pct", { precision: 6, scale: 4 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (t) => [index("price_card_lines_card_idx").on(t.priceCardId)]
);

export const commitments = pgTable("commitments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // provisioned_throughput|reserved_capacity|enterprise_commit
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id),
  amountUsd: numeric("amount_usd", { precision: 14, scale: 2 }),
  unit: text("unit").notNull().default("USD"), // USD|tokens|ptu|rpm
  capacityAmount: numeric("capacity_amount", { precision: 20, scale: 4 }),
  termStart: timestamp("term_start", { withTimezone: true }).notNull(),
  termEnd: timestamp("term_end", { withTimezone: true }).notNull(),
  applicableSkuIds: jsonb("applicable_sku_ids").$type<string[]>().default([]),
  applicableMeterIds: jsonb("applicable_meter_ids").$type<string[]>().default([]),
  drawdownMethod: text("drawdown_method").notNull().default("fifo"),
  utilizationTargetPct: numeric("utilization_target_pct", { precision: 6, scale: 2 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
});

/**
 * FOCUS-aligned cost records.
 * billedCost = list; effectiveCost = after discounts/commits/credits.
 */
export const costRecords = pgTable(
  "cost_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    usageEventId: uuid("usage_event_id").references(() => usageEvents.id),
    usageDailyId: uuid("usage_daily_id").references(() => usageDaily.id),
    chargePeriodStart: timestamp("charge_period_start", { withTimezone: true }).notNull(),
    chargePeriodEnd: timestamp("charge_period_end", { withTimezone: true }).notNull(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    skuId: uuid("sku_id").references(() => skus.id),
    meterId: uuid("meter_id")
      .notNull()
      .references(() => meters.id),
    serviceName: text("service_name").notNull(), // FOCUS ServiceName
    focusSkuId: text("focus_sku_id"), // FOCUS SkuId string
    consumedQuantity: numeric("consumed_quantity", { precision: 24, scale: 6 }).notNull(),
    consumedUnit: text("consumed_unit").notNull(),
    billedCost: numeric("billed_cost", { precision: 18, scale: 6 }).notNull(),
    effectiveCost: numeric("effective_cost", { precision: 18, scale: 6 }).notNull(),
    listUnitPrice: numeric("list_unit_price", { precision: 18, scale: 10 }),
    effectiveUnitPrice: numeric("effective_unit_price", { precision: 18, scale: 10 }),
    priceCardId: uuid("price_card_id").references(() => priceCards.id),
    priceCardLineId: uuid("price_card_line_id").references(() => priceCardLines.id),
    commitmentId: uuid("commitment_id").references(() => commitments.id),
    commitmentSavings: numeric("commitment_savings", { precision: 18, scale: 6 }).default("0"),
    tags: jsonb("tags").$type<Record<string, string>>().notNull().default({}),
    allocationStatus: text("allocation_status").notNull().default("allocated"),
  },
  (t) => [
    index("cost_records_org_period_idx").on(t.orgId, t.chargePeriodStart),
    index("cost_records_provider_idx").on(t.providerId),
  ]
);

export const costRecordDimensions = pgTable(
  "cost_record_dimensions",
  {
    costRecordId: uuid("cost_record_id")
      .notNull()
      .references(() => costRecords.id, { onDelete: "cascade" }),
    dimensionTypeId: uuid("dimension_type_id")
      .notNull()
      .references(() => dimensionTypes.id),
    dimensionNodeId: uuid("dimension_node_id")
      .notNull()
      .references(() => dimensionNodes.id),
  },
  (t) => [primaryKey({ columns: [t.costRecordId, t.dimensionTypeId] })]
);

export const commitmentDrawdowns = pgTable("commitment_drawdowns", {
  id: uuid("id").primaryKey().defaultRandom(),
  commitmentId: uuid("commitment_id")
    .notNull()
    .references(() => commitments.id),
  costRecordId: uuid("cost_record_id").references(() => costRecords.id),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  amountApplied: numeric("amount_applied", { precision: 18, scale: 6 }).notNull(),
  remainingBalance: numeric("remaining_balance", { precision: 18, scale: 6 }),
});

export const allocationRules = pgTable("allocation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  priority: integer("priority").notNull().default(100),
  match: jsonb("match").$type<Record<string, string>>().notNull().default({}),
  set: jsonb("set").$type<Record<string, string>>().notNull().default({}),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
});

export const drivers = pgTable(
  "drivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    unit: text("unit").notNull(), // users|requests|tokens|ratio|pct
    parentId: uuid("parent_id"),
    featureKey: text("feature_key"),
    formula: text("formula").notNull().default("leaf"), // leaf | parent * self
    isFitted: boolean("is_fitted").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    scopeDimensionNodeId: uuid("scope_dimension_node_id").references(
      () => dimensionNodes.id
    ),
  },
  (t) => [uniqueIndex("drivers_org_key_feature").on(t.orgId, t.key, t.featureKey)]
);

export const driverValues = pgTable(
  "driver_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    value: numeric("value", { precision: 20, scale: 8 }).notNull(),
    source: text("source").notNull().default("actual"), // actual|fitted|override
  },
  (t) => [index("driver_values_driver_period").on(t.driverId, t.periodStart)]
);

export const scenarios = pgTable("scenarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
  horizonMonths: integer("horizon_months").notNull().default(12),
  baselineScenarioId: uuid("baseline_scenario_id"),
  status: text("status").notNull().default("draft"), // draft|active|archived
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scenarioOverrides = pgTable("scenario_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  overrideType: text("override_type").notNull(), // driver|price_card|routing|commitment|adoption
  targetId: uuid("target_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
});

export const scenarioResults = pgTable(
  "scenario_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    grain: jsonb("grain").$type<Record<string, string>>().notNull().default({}),
    p10Cost: numeric("p10_cost", { precision: 18, scale: 6 }).notNull(),
    p50Cost: numeric("p50_cost", { precision: 18, scale: 6 }).notNull(),
    p90Cost: numeric("p90_cost", { precision: 18, scale: 6 }).notNull(),
    driverSnapshot: jsonb("driver_snapshot").$type<Record<string, unknown>>().default({}),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scenario_results_scenario_day").on(t.scenarioId, t.day)]
);

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  period: text("period").notNull().default("monthly"), // monthly|quarterly|annual
  scopeType: text("scope_type").notNull().default("org"), // org|dimension|feature|dimension+feature
  dimensionTypeId: uuid("dimension_type_id").references(() => dimensionTypes.id),
  dimensionNodeId: uuid("dimension_node_id").references(() => dimensionNodes.id),
  featureKey: text("feature_key"),
  includeDescendants: boolean("include_descendants").notNull().default(true),
  thresholds: jsonb("thresholds").$type<number[]>().notNull().default([0.5, 0.8, 1.0]),
  alertChannels: jsonb("alert_channels").$type<Record<string, unknown>>().default({}),
});

export const budgetAlerts = pgTable("budget_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetId: uuid("budget_id")
    .notNull()
    .references(() => budgets.id, { onDelete: "cascade" }),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  thresholdPct: numeric("threshold_pct", { precision: 6, scale: 4 }).notNull(),
  projectedBreachDate: date("projected_breach_date"),
  message: text("message").notNull(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});

export const mappingTemplates = pgTable("mapping_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id),
  name: text("name").notNull(),
  columnMap: jsonb("column_map").$type<Record<string, string>>().notNull().default({}),
});

export const connectors = pgTable("connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  providerId: uuid("provider_id")
    .notNull()
    .references(() => providers.id),
  tier: integer("tier").notNull(),
  status: text("status").notNull().default("disconnected"),
  // disconnected|authenticating|backfilling|healthy|degraded|error
  authConfig: jsonb("auth_config").$type<Record<string, unknown>>().default({}),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  backfillProgressPct: numeric("backfill_progress_pct", { precision: 6, scale: 2 }).default("0"),
  spendCoveredPct: numeric("spend_covered_pct", { precision: 6, scale: 2 }),
  allocatedPct: numeric("allocated_pct", { precision: 6, scale: 2 }),
  allocatedByDimension: jsonb("allocated_by_dimension")
    .$type<Record<string, number>>()
    .default({}),
  mappingTemplateId: uuid("mapping_template_id").references(() => mappingTemplates.id),
  healthMessage: text("health_message"),
});

export const connectorSyncRuns = pgTable("connector_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectorId: uuid("connector_id")
    .notNull()
    .references(() => connectors.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  phase: text("phase").notNull(), // discover|backfill|incremental
  rowsIn: integer("rows_in").default(0),
  rowsWritten: integer("rows_written").default(0),
  errors: jsonb("errors").$type<unknown[]>().default([]),
});

export const otelIngestKeys = pgTable("otel_ingest_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  keyHash: text("key_hash").notNull(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const seatSnapshots = pgTable(
  "seat_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    asOf: date("as_of").notNull(),
    seatsPurchased: integer("seats_purchased").notNull(),
    seatsActive: integer("seats_active").notNull(),
    seatsHeavy: integer("seats_heavy").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  },
  (t) => [uniqueIndex("seat_snapshots_org_provider_day").on(t.orgId, t.providerId, t.asOf)]
);
