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

/** Per-workspace people-CSV dimension configuration (grouping for Home rollups). */
export type PeopleDimensionColumnConfig = {
  /** Stable key in contributors.attributes */
  key: string;
  /** Original CSV header */
  sourceColumn: string;
  displayName: string;
  enabled: boolean;
  /** Exactly one primary; optionally one secondary — Home default order only */
  role: "primary" | "secondary" | null;
  suggestion: "identifier" | "constant" | "dimension";
  distinctCount: number;
  sampleValues: string[];
};

export type PeopleDimensionConfig = {
  columns: PeopleDimensionColumnConfig[];
  profiledAt: string | null;
  rowCount: number;
};

/** Workspace forecast settings — seat cost optional; locked periods never overwritten. */
export type ForecastConfig = {
  /** Monthly seat cost USD; without this, dormant seat savings are never implied. */
  seatCostMonthlyUsd: number | null;
  /** Calendar months (YYYY-MM) that must not receive forecast writes / overrides. */
  lockedPeriods: string[];
};

export const emptyForecastConfig = (): ForecastConfig => ({
  seatCostMonthlyUsd: null,
  lockedPeriods: [],
});

/** Typed payload for driver-based scenario overrides (stored in scenario_overrides.payload). */
export type DriverScenarioOverridePayload = {
  kind:
    | "headcount"
    | "adoption"
    | "price_index"
    | "spend_per_active_user"
    | "per_user_cap"
    | "reorg";
  dimensionKey: string;
  /** Dimension value the override applies to (source group for reorg). */
  dimensionValue: string;
  /** Receiving group for reorg — uses that group's drivers. */
  toDimensionValue?: string;
  /** Absolute override for the driver (or planned headcount). */
  value?: number;
  /** Additive headcount delta (alternative to absolute value). */
  headcountDelta?: number;
  /** Price / adoption changes apply from this period forward (YYYY-MM). */
  effectiveFromPeriod?: string;
};

/** Demo org + multi-tenant ready */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** SHA-256 of workspace access token — gates private workspaces without user accounts. */
  accessTokenHash: text("access_token_hash"),
  /**
   * When false (default), any browser can list and open this workspace.
   * When true, only browsers that claim the access token can see/open it.
   */
  isPrivate: boolean("is_private").notNull().default(false),
  /** When set, workspace is showing deterministic FinOps sample fixtures — show watermark. */
  sampleDataLoadedAt: timestamp("sample_data_loaded_at", { withTimezone: true }),
  /**
   * User-defined people-CSV dimensions (enabled columns + primary/secondary).
   * Changing this updates rollups without re-import.
   */
  peopleDimensionConfig: jsonb("people_dimension_config")
    .$type<PeopleDimensionConfig>()
    .notNull()
    .default({ columns: [], profiledAt: null, rowCount: 0 }),
  /**
   * Driver-forecast settings (seat cost, locked periods).
   * Absent seat cost → never imply dormant seat savings.
   */
  forecastConfig: jsonb("forecast_config")
    .$type<ForecastConfig>()
    .notNull()
    .default({ seatCostMonthlyUsd: null, lockedPeriods: [] }),
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
    costCenterCode: text("cost_center_code"),
    ownerEmail: text("owner_email"),
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
    importBatchId: uuid("import_batch_id"), // → import_batches (set without FK to avoid cycle)
    contentHash: text("content_hash"),
    chargePeriodStart: timestamp("charge_period_start", { withTimezone: true }),
    chargePeriodEnd: timestamp("charge_period_end", { withTimezone: true }),
    allocationStatus: text("allocation_status").notNull().default("allocated"), // allocated|unallocated
  },
  (t) => [
    index("usage_events_org_time_idx").on(t.orgId, t.eventTime),
    index("usage_events_provider_idx").on(t.providerId),
    index("usage_events_sku_idx").on(t.skuId),
    index("usage_events_meter_idx").on(t.meterId),
    index("usage_events_batch_idx").on(t.importBatchId),
    uniqueIndex("usage_events_org_content_hash").on(t.orgId, t.contentHash),
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
    importBatchId: uuid("import_batch_id"),
    contentHash: text("content_hash"),
  },
  (t) => [
    index("cost_records_org_period_idx").on(t.orgId, t.chargePeriodStart),
    index("cost_records_provider_idx").on(t.providerId),
    index("cost_records_batch_idx").on(t.importBatchId),
    uniqueIndex("cost_records_org_content_hash").on(t.orgId, t.contentHash),
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
  parentBudgetId: uuid("parent_budget_id"),
  currentVersionId: uuid("current_version_id"),
});

export type BudgetPolicyAction =
  | "notify"
  | "require_approval"
  | "advisory_downgrade"
  | "advisory_block";

export type BudgetPolicyRule = {
  pct: number;
  action: BudgetPolicyAction;
  recommendedModel?: string;
};

export const budgetVersions = pgTable(
  "budget_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    period: text("period").notNull().default("monthly"),
    scopeType: text("scope_type").notNull().default("org"),
    dimensionTypeId: uuid("dimension_type_id"),
    dimensionNodeId: uuid("dimension_node_id"),
    featureKey: text("feature_key"),
    includeDescendants: boolean("include_descendants").notNull().default(true),
    thresholds: jsonb("thresholds").$type<number[]>().notNull().default([0.5, 0.8, 1.0]),
    policy: jsonb("policy").$type<BudgetPolicyRule[]>().notNull().default([]),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    author: text("author").notNull().default("system"),
    changeNote: text("change_note").notNull(),
    reallocationGroupId: uuid("reallocation_group_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("budget_versions_budget_version").on(t.budgetId, t.version),
    index("budget_versions_effective_idx").on(t.budgetId, t.effectiveFrom),
  ]
);

export const budgetAlerts = pgTable("budget_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetId: uuid("budget_id")
    .notNull()
    .references(() => budgets.id, { onDelete: "cascade" }),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  thresholdPct: numeric("threshold_pct", { precision: 6, scale: 4 }).notNull(),
  projectedBreachDate: date("projected_breach_date"),
  message: text("message").notNull(),
  policyAction: text("policy_action"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});

export const budgetStatusSnapshots = pgTable(
  "budget_status_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    dimensionNodeId: uuid("dimension_node_id"),
    featureKey: text("feature_key"),
    status: text("status").notNull().default("ok"), // ok|warn|exceeded
    policyAction: text("policy_action"),
    remaining: numeric("remaining", { precision: 14, scale: 2 }).notNull().default("0"),
    spent: numeric("spent", { precision: 14, scale: 2 }).notNull().default("0"),
    projectedP50: numeric("projected_p50", { precision: 14, scale: 2 }),
    breachDate: date("breach_date"),
    periodEnd: date("period_end"),
    recommendedModel: text("recommended_model"),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("budget_status_budget").on(t.budgetId)]
);

export const mappingTemplates = pgTable("mapping_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id), // null = system template
  providerId: uuid("provider_id").references(() => providers.id),
  name: text("name").notNull(),
  sourceFormat: text("source_format").notNull().default("usage_export"),
  // usage_export | invoice | org_structure | value_metric
  isSystem: boolean("is_system").notNull().default(false),
  columnMap: jsonb("column_map").$type<Record<string, string>>().notNull().default({}),
  sampleHeaders: jsonb("sample_headers").$type<string[]>().default([]),
});

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    sourceKind: text("source_kind").notNull(), // csv | jsonl | invoice
    fileName: text("file_name").notNull(),
    contentHash: text("content_hash").notNull(),
    mappingTemplateId: uuid("mapping_template_id").references(() => mappingTemplates.id),
    status: text("status").notNull().default("previewing"),
    // previewing|importing|completed|failed|rolled_back
    rowCount: integer("row_count").notNull().default(0),
    rowsWritten: integer("rows_written").notNull().default(0),
    rowsSkipped: integer("rows_skipped").notNull().default(0),
    rowsErrored: integer("rows_errored").notNull().default(0),
    errorReport: jsonb("error_report")
      .$type<{ row: number; field?: string; message: string }[]>()
      .notNull()
      .default([]),
    createdBy: text("created_by").notNull().default("demo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  },
  (t) => [index("import_batches_org_hash_idx").on(t.orgId, t.contentHash)]
);

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
  // disconnected|authenticating|backfilling|healthy|degraded|error|stale
  authConfig: jsonb("auth_config").$type<Record<string, unknown>>().default({}),
  credentialsEncrypted: text("credentials_encrypted"),
  credentialsKeyId: text("credentials_key_id"),
  syncCursor: jsonb("sync_cursor").$type<Record<string, unknown>>().default({}),
  demoMode: boolean("demo_mode").notNull().default(false),
  staleAfterHours: integer("stale_after_hours").notNull().default(24),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastErrorMessage: text("last_error_message"),
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

/**
 * Rung 1 attribution — map Anthropic api_key / workspace tags to a dimension node.
 * Zero customer instrumentation: Admin sync discovers keys; users assign teams here.
 */
export const providerKeyRegistry = pgTable(
  "provider_key_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    kind: text("kind").notNull(), // api_key | workspace
    externalId: text("external_id").notNull(),
    displayName: text("display_name"),
    dimensionNodeId: uuid("dimension_node_id").references(() => dimensionNodes.id),
    isServiceAccount: boolean("is_service_account").notNull().default(false),
    serviceLabel: text("service_label"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_key_registry_org_prov_kind_ext").on(
      t.orgId,
      t.providerId,
      t.kind,
      t.externalId
    ),
    index("provider_key_registry_org_unmapped").on(t.orgId, t.dimensionNodeId),
  ]
);

export const otelIngestKeys = pgTable(
  "otel_ingest_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull().default("meter_"),
    label: text("label").notNull(),
    envTag: text("env_tag").notNull().default("prod"), // prod|staging|dev
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: text("created_by").notNull().default("system"),
    rotatedFromId: uuid("rotated_from_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("otel_keys_org_hash").on(t.orgId, t.keyHash)]
);

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

/** Retroactive allocation rule applications (WS2) */
export const allocationRuleApplications = pgTable("allocation_rule_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  ruleId: uuid("rule_id")
    .notNull()
    .references(() => allocationRules.id, { onDelete: "cascade" }),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  eventsTouched: integer("events_touched").notNull().default(0),
  allocatedPctBefore: numeric("allocated_pct_before", { precision: 6, scale: 4 }),
  allocatedPctAfter: numeric("allocated_pct_after", { precision: 6, scale: 4 }),
  appliedBy: text("applied_by").notNull().default("demo"),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_org_created").on(t.orgId, t.createdAt)]
);

export const orgWebhooks = pgTable("org_webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** WS5 — outcome / ROI */
export const valueMetrics = pgTable(
  "value_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    featureKey: text("feature_key").notNull(),
    unitKey: text("unit_key").notNull(), // tickets_resolved, prs_merged, …
    displayName: text("display_name").notNull(),
    source: text("source").notNull().default("manual"), // manual|csv|otel_tag
    otelTagKey: text("otel_tag_key"),
    dollarPerUnit: numeric("dollar_per_unit", { precision: 14, scale: 4 }),
    owningDimensionNodeId: uuid("owning_dimension_node_id").references(
      () => dimensionNodes.id
    ),
  },
  (t) => [uniqueIndex("value_metrics_org_feature_unit").on(t.orgId, t.featureKey, t.unitKey)]
);

export const valueEvents = pgTable(
  "value_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    valueMetricId: uuid("value_metric_id")
      .notNull()
      .references(() => valueMetrics.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
    source: text("source").notNull().default("manual"),
    importBatchId: uuid("import_batch_id"),
    tags: jsonb("tags").$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("value_events_metric_period").on(t.valueMetricId, t.periodStart)]
);

/** Workspace people / HRIS roster (not login accounts) */
export const contributors = pgTable(
  "contributors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    githubLogin: text("github_login"),
    githubId: text("github_id"),
    externalIds: jsonb("external_ids").$type<Record<string, string>>().notNull().default({}),
    dimensionNodeId: uuid("dimension_node_id").references(() => dimensionNodes.id),
    /**
     * @deprecated Prefer attributes. Kept for migration of pre-dimension workspaces.
     */
    department: text("department"),
    /** @deprecated Prefer attributes. */
    costCenter: text("cost_center"),
    /**
     * @deprecated Prefer attributes. Legacy chain keyed by padded level ("02"…"07").
     */
    costCenterChain: jsonb("cost_center_chain")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    /** @deprecated Prefer attributes. */
    costCenterPath: text("cost_center_path"),
    /**
     * Full people-CSV attribute map (source column key → value).
     * Every non-identity column is stored here; grouping is config-driven.
     */
    attributes: jsonb("attributes")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    /** active | terminated | leave | contractor */
    employmentStatus: text("employment_status").notNull().default("active"),
    startedOn: date("started_on"),
    endedOn: date("ended_on"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contributors_org_email").on(t.orgId, t.email),
    index("contributors_org_github").on(t.orgId, t.githubLogin),
    index("contributors_org_dept").on(t.orgId, t.department),
  ]
);

export const contributorTeamMemberships = pgTable(
  "contributor_team_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => contributors.id, { onDelete: "cascade" }),
    dimensionNodeId: uuid("dimension_node_id")
      .notNull()
      .references(() => dimensionNodes.id),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
  },
  (t) => [index("contributor_team_contrib").on(t.contributorId)]
);

export const scmConnections = pgTable(
  "scm_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    provider: text("provider").notNull().default("github"), // github|gitlab
    accountLogin: text("account_login"),
    status: text("status").notNull().default("disconnected"), // disconnected|healthy|error
    credentialsEncrypted: text("credentials_encrypted"),
    credentialsKeyId: text("credentials_key_id"),
    selectedRepos: jsonb("selected_repos").$type<string[]>().default([]),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("scm_connections_org_provider").on(t.orgId, t.provider)]
);

export const pullRequests = pgTable(
  "pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    scmConnectionId: uuid("scm_connection_id")
      .notNull()
      .references(() => scmConnections.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull().default(""),
    authorContributorId: uuid("author_contributor_id").references(() => contributors.id),
    authorLogin: text("author_login"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    aiAssisted: boolean("ai_assisted"),
  },
  (t) => [
    uniqueIndex("pull_requests_conn_repo_num").on(t.scmConnectionId, t.repo, t.number),
    index("pull_requests_org_merged").on(t.orgId, t.mergedAt),
  ]
);

/** DX-shaped daily AI tool grain */
export const aiToolDaily = pgTable(
  "ai_tool_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    day: date("day").notNull(),
    toolKey: text("tool_key").notNull(), // claude_code|cursor|copilot|codex|anthropic_api|…
    /** uuid or 'unattributed' — avoids NULL unique issues */
    contributorKey: text("contributor_key").notNull().default("unattributed"),
    contributorId: uuid("contributor_id").references(() => contributors.id),
    dimensionNodeId: uuid("dimension_node_id").references(() => dimensionNodes.id),
    spend: numeric("spend", { precision: 18, scale: 6 }).notNull().default("0"),
    tokensIn: numeric("tokens_in", { precision: 20, scale: 2 }).notNull().default("0"),
    tokensOut: numeric("tokens_out", { precision: 20, scale: 2 }).notNull().default("0"),
    tokensTotal: numeric("tokens_total", { precision: 20, scale: 2 }).notNull().default("0"),
    sessions: integer("sessions").notNull().default(0),
    requests: integer("requests").notNull().default(0),
    sourceConnector: text("source_connector").notNull().default("manual"),
    contentHash: text("content_hash"),
  },
  (t) => [
    uniqueIndex("ai_tool_daily_grain").on(t.orgId, t.day, t.toolKey, t.contributorKey),
    index("ai_tool_daily_org_day").on(t.orgId, t.day),
  ]
);

export const aiSessions = pgTable(
  "ai_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    toolKey: text("tool_key").notNull(),
    contributorId: uuid("contributor_id").references(() => contributors.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    useCase: text("use_case").notNull().default("unknown"),
    tokens: numeric("tokens", { precision: 20, scale: 2 }).default("0"),
    spend: numeric("spend", { precision: 18, scale: 6 }).default("0"),
    prExternalId: text("pr_external_id"),
  },
  (t) => [index("ai_sessions_org_started").on(t.orgId, t.startedAt)]
);

/** Per-tool primary source to avoid double-count (WS-B5) */
export const aiToolSourcePrefs = pgTable(
  "ai_tool_source_prefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    toolKey: text("tool_key").notNull(),
    primarySource: text("primary_source").notNull(), // anthropic_console|claude_enterprise|otel|cursor|…
  },
  (t) => [uniqueIndex("ai_tool_source_prefs_org_tool").on(t.orgId, t.toolKey)]
);

/** WS6 — Auth.js + RBAC + audit (tables ready; Auth.js wiring later) */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("viewer"), // org_admin|finance|node_owner|viewer
    scopedDimensionNodeId: uuid("scoped_dimension_node_id").references(
      () => dimensionNodes.id
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorLabel: text("actor_label").notNull().default("system"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_org_created").on(t.orgId, t.createdAt)]
);

/**
 * Optional headcount plan by people-dimension value × calendar month.
 * Absent → forecast holds last roster HC flat ("flat headcount — no plan loaded").
 */
export const headcountPlans = pgTable(
  "headcount_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Matches people_dimension_config column key (e.g. attributes key). */
    dimensionKey: text("dimension_key").notNull(),
    dimensionValue: text("dimension_value").notNull(),
    /** First day of calendar month (YYYY-MM-01). */
    periodStart: date("period_start").notNull(),
    plannedHeadcount: numeric("planned_headcount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    source: text("source").notNull().default("csv"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("headcount_plans_org_dim_period").on(
      t.orgId,
      t.dimensionKey,
      t.dimensionValue,
      t.periodStart
    ),
    index("headcount_plans_org_dim").on(t.orgId, t.dimensionKey),
  ]
);
