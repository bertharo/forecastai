/**
 * Driver-based people-dimension forecast types.
 * Grain is always calendar months. No hardcoded dimension names/levels.
 */

export type PeriodKey = string; // YYYY-MM

export type DriverKind =
  | "headcount"
  | "adoption_rate"
  | "spend_per_active_user"
  | "price_index";

/** One month of attributed history for a single dimension value. */
export type HistoryMonth = {
  period: PeriodKey;
  dimensionValue: string;
  spend: number;
  /** Distinct active users (emails with spend) in the month. */
  activeUsers: number;
  /** Roster headcount for this dimension value active in the month. */
  headcount: number;
};

export type DriverValueView = {
  kind: DriverKind;
  /** Baseline fitted from history (or 1.0 for price_index default). */
  baseline: number;
  /** Scenario / manual override when set. */
  override: number | null;
  /** Value actually used in the forecast cell. */
  effective: number;
  source: "baseline" | "override" | "plan" | "flat_headcount";
  assumption?: string;
};

export type DimensionValueDrivers = {
  dimensionValue: string;
  headcount: DriverValueView;
  adoptionRate: DriverValueView;
  spendPerActiveUser: DriverValueView;
  priceIndex: DriverValueView;
};

export type ForecastCell = {
  period: PeriodKey;
  dimensionValue: string;
  kind: "actual" | "forecast";
  spend: number;
  p10: number | null;
  p90: number | null;
  bandMeaningful: boolean;
  drivers: DimensionValueDrivers;
  locked: boolean;
  assumptions: string[];
};

export type ForecastSeries = {
  dimensionKey: string;
  dimensionDisplayName: string;
  lastActualPeriod: PeriodKey | null;
  periods: PeriodKey[];
  values: string[];
  cells: ForecastCell[];
  /** Totals by period across all dimension values. */
  totalsByPeriod: Record<
    PeriodKey,
    { spend: number; p10: number | null; p90: number | null; kind: "actual" | "forecast" }
  >;
};

export type ForecastCapabilities = {
  hasSpend: boolean;
  hasRoster: boolean;
  hasConfiguredDimensions: boolean;
  hasHeadcountPlan: boolean;
  hasLifecycleFields: boolean;
  hasSeatCost: boolean;
  historyMonthCount: number;
  labels: string[];
};

export type LifecycleFinding = {
  id: string;
  kind: "spend_after_end" | "dormant" | "new_hire_assumption";
  title: string;
  detail: string;
  count?: number;
  share?: number;
  impact?: number | null;
  /** True only when seat cost is configured and savings are claimed. */
  impliesSeatSavings: boolean;
};

export type ScenarioCompareRow = {
  dimensionValue: string;
  period: PeriodKey;
  baselineSpend: number;
  scenarioSpend: number;
  delta: number;
  deltaPct: number;
  driversChanged: DriverKind[];
};

export type HeadcountPlanRow = {
  dimensionValue: string;
  period: PeriodKey;
  plannedHeadcount: number;
};

export type PriceIndexPoint = {
  period: PeriodKey;
  /** Relative to reference period; 1.0 = no change. */
  index: number;
};
