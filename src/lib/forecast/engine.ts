/**
 * Meter forecast engine — pure TypeScript, no DB deps.
 * Forecast = driver tree × price cards × commitments, with P10/P50/P90 bands.
 */

export type AdoptionCurve = "linear" | "logistic" | "cohort";

export interface AdoptionParams {
  curve: AdoptionCurve;
  current: number; // 0–1
  target: number; // 0–1
  weeksToSaturation: number;
  /** logistic steepness; default derived from weeks */
  k?: number;
  /** cohort: weekly new users joining */
  cohortWeeklyNew?: number;
  /** cohort: retention by week age */
  retentionByAge?: number[];
  /** cohort helper: addressable user base */
  addressableBase?: number;
}

export interface PriceLine {
  skuId: string;
  meterKey: string;
  unitPrice: number; // USD per unit
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface RouteSplit {
  skuId: string;
  share: number; // 0–1
  avgInputTokens: number;
  avgOutputTokens: number;
  cacheHitRate?: number;
  verbosityMultiplier?: number; // model-switch assumption
  batchFraction?: number;
  batchDiscount?: number; // e.g. 0.5 = 50% off
}

export interface FeatureDrivers {
  featureKey: string;
  weeklyActiveUsers: number;
  requestsPerActiveUser: number; // per week
  adoption: number; // current fitted
  routes: RouteSplit[];
  /** residual CV for uncertainty bands */
  residualCv?: number;
}

export interface DriverTree {
  features: FeatureDrivers[];
  addressableUsers?: number;
}

export interface ForecastDay {
  day: Date;
  p10: number;
  p50: number;
  p90: number;
  byFeature: Record<string, { p10: number; p50: number; p90: number }>;
  drivers: Record<string, number>;
}

export interface CommitmentInput {
  id: string;
  monthlyAmountUsd: number;
  discountPct: number; // applied to matching spend
  applicableSkuIds?: string[];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Adoption at week offset t (0 = start). */
export function projectAdoption(params: AdoptionParams, weekOffset: number): number {
  const { curve, current, target, weeksToSaturation } = params;
  if (weeksToSaturation <= 0) return target;

  if (curve === "linear") {
    const prog = clamp01(weekOffset / weeksToSaturation);
    return current + (target - current) * prog;
  }

  if (curve === "logistic") {
    const k = params.k ?? 6 / weeksToSaturation;
    const tMid = weeksToSaturation / 2;
    const logistic = 1 / (1 + Math.exp(-k * (weekOffset - tMid)));
    // normalize so t=0 ≈ current and t→∞ ≈ target
    const at0 = 1 / (1 + Math.exp(-k * (0 - tMid)));
    const atInf = 1;
    const norm = (logistic - at0) / (atInf - at0 || 1);
    return current + (target - current) * clamp01(norm);
  }

  // cohort: smoothstep ramp (retention series reserved for richer cohort math)
  const prog = clamp01(weekOffset / weeksToSaturation);
  const s = prog * prog * (3 - 2 * prog);
  return current + (target - current) * s;
}

/** Pick unit price in effect at time t (price-card time travel). */
export function priceAtTime(
  lines: PriceLine[],
  skuId: string,
  meterKey: string,
  at: Date
): number {
  const candidates = lines.filter(
    (l) =>
      l.skuId === skuId &&
      l.meterKey === meterKey &&
      l.effectiveFrom.getTime() <= at.getTime() &&
      (l.effectiveTo === null || l.effectiveTo.getTime() > at.getTime())
  );
  if (candidates.length === 0) return 0;
  // prefer latest effectiveFrom
  candidates.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return candidates[0].unitPrice;
}

/** Cost of one request under a route at time t. */
export function routeRequestCost(
  route: RouteSplit,
  lines: PriceLine[],
  at: Date,
  cacheWriteShare = 0.1
): number {
  const verbosity = route.verbosityMultiplier ?? 1;
  const inputPrice = priceAtTime(lines, route.skuId, "input_tokens", at);
  const outputPrice = priceAtTime(lines, route.skuId, "output_tokens", at);
  const cacheReadPrice = priceAtTime(lines, route.skuId, "cache_read_tokens", at);
  const cacheWritePrice = priceAtTime(lines, route.skuId, "cache_write_tokens", at);

  const hit = route.cacheHitRate ?? 0;
  const inputTokens = route.avgInputTokens;
  const outputTokens = route.avgOutputTokens * verbosity;

  let cost: number;
  if (cacheReadPrice > 0 || cacheWritePrice > 0) {
    const cacheRead = inputTokens * hit;
    const cacheWrite = inputTokens * (1 - hit) * cacheWriteShare;
    const billableInput = inputTokens * (1 - hit) * (1 - cacheWriteShare);
    cost =
      billableInput * inputPrice +
      outputTokens * outputPrice +
      cacheRead * (cacheReadPrice || inputPrice * 0.1) +
      cacheWrite * (cacheWritePrice || inputPrice * 1.25);
  } else {
    // Cache hit reduces billable input when no dedicated cache meters
    const billableInput = inputTokens * (1 - hit);
    cost = billableInput * inputPrice + outputTokens * outputPrice;
  }

  const batchFrac = route.batchFraction ?? 0;
  const batchDisc = route.batchDiscount ?? 0.5;
  return cost * (1 - batchFrac) + cost * batchFrac * batchDisc;
}

export function featureWeeklyCost(
  feature: FeatureDrivers,
  lines: PriceLine[],
  at: Date,
  adoptionOverride?: number
): number {
  const adoption = adoptionOverride ?? feature.adoption;
  const requests =
    feature.weeklyActiveUsers * adoption * feature.requestsPerActiveUser;
  let cost = 0;
  for (const route of feature.routes) {
    cost += requests * route.share * routeRequestCost(route, lines, at);
  }
  return cost;
}

function applyCommitments(
  spendBySku: Record<string, number>,
  commitments: CommitmentInput[]
): { effective: number; savings: number } {
  let total = Object.values(spendBySku).reduce((a, b) => a + b, 0);
  let savings = 0;
  for (const c of commitments) {
    let eligible = total;
    if (c.applicableSkuIds?.length) {
      eligible = c.applicableSkuIds.reduce((s, id) => s + (spendBySku[id] ?? 0), 0);
    }
    const disc = eligible * c.discountPct;
    savings += disc;
    total -= disc;
  }
  return { effective: Math.max(0, total), savings };
}

export interface ProjectOptions {
  start: Date;
  horizonDays: number;
  tree: DriverTree;
  priceLines: PriceLine[];
  commitments?: CommitmentInput[];
  /** featureKey → adoption params */
  adoptionByFeature?: Record<string, AdoptionParams>;
  /** default residual CV if feature doesn't specify */
  defaultResidualCv?: number;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/**
 * Project daily P10/P50/P90 over horizon.
 * Daily cost ≈ weekly feature cost / 7 (inspectable; not a black box).
 */
export function projectForecast(opts: ProjectOptions): ForecastDay[] {
  const {
    start,
    horizonDays,
    tree,
    priceLines,
    commitments = [],
    adoptionByFeature = {},
    defaultResidualCv = 0.15,
  } = opts;

  const out: ForecastDay[] = [];

  for (let i = 0; i < horizonDays; i++) {
    const day = addDays(start, i);
    const weekOffset = i / 7;
    const byFeature: ForecastDay["byFeature"] = {};
    const drivers: Record<string, number> = {};
    let p50Total = 0;
    let p10Total = 0;
    let p90Total = 0;
    const spendBySku: Record<string, number> = {};

    for (const feature of tree.features) {
      const adopParams = adoptionByFeature[feature.featureKey];
      const adoption = adopParams
        ? projectAdoption(adopParams, weekOffset)
        : feature.adoption;
      drivers[`${feature.featureKey}.adoption`] = adoption;
      drivers[`${feature.featureKey}.wau`] = feature.weeklyActiveUsers;
      drivers[`${feature.featureKey}.req_per_user`] = feature.requestsPerActiveUser;

      const weekly = featureWeeklyCost(feature, priceLines, day, adoption);
      const daily = weekly / 7;
      const cv = feature.residualCv ?? defaultResidualCv;
      // simple normal-ish bands via CV
      const p10 = daily * Math.max(0, 1 - 1.28 * cv);
      const p90 = daily * (1 + 1.28 * cv);

      byFeature[feature.featureKey] = { p10, p50: daily, p90 };
      p50Total += daily;
      p10Total += p10;
      p90Total += p90;

      for (const route of feature.routes) {
        const routeDaily =
          (feature.weeklyActiveUsers *
            adoption *
            feature.requestsPerActiveUser *
            route.share *
            routeRequestCost(route, priceLines, day)) /
          7;
        spendBySku[route.skuId] = (spendBySku[route.skuId] ?? 0) + routeDaily;
      }
    }

    // Scale commit discounts across the day (monthly → daily approx)
    const dailyCommitments = commitments.map((c) => ({
      ...c,
      discountPct: c.discountPct,
    }));
    const { effective } = applyCommitments(spendBySku, dailyCommitments);
    const commitFactor = p50Total > 0 ? effective / p50Total : 1;

    out.push({
      day,
      p10: p10Total * commitFactor,
      p50: effective,
      p90: p90Total * commitFactor,
      byFeature,
      drivers,
    });
  }

  return out;
}

/** Fit simple mean drivers from historical daily series. */
export function fitDriverMean(values: number[]): { mean: number; stdev: number; cv: number } {
  if (values.length === 0) return { mean: 0, stdev: 0, cv: 0.15 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1);
  const stdev = Math.sqrt(variance);
  const cv = mean === 0 ? 0.15 : stdev / Math.abs(mean);
  return { mean, stdev, cv };
}

/**
 * Model-switch: replay workload under alternate routing.
 * Returns cost delta vs baseline for the same request volume.
 */
export function modelSwitchDelta(args: {
  requests: number;
  baselineRoutes: RouteSplit[];
  targetRoutes: RouteSplit[];
  priceLines: PriceLine[];
  at: Date;
}): {
  baselineCost: number;
  targetCost: number;
  delta: number;
  deltaPct: number;
} {
  const { requests, baselineRoutes, targetRoutes, priceLines, at } = args;
  const baselineCost = baselineRoutes.reduce(
    (s, r) => s + requests * r.share * routeRequestCost(r, priceLines, at),
    0
  );
  const targetCost = targetRoutes.reduce(
    (s, r) => s + requests * r.share * routeRequestCost(r, priceLines, at),
    0
  );
  const delta = targetCost - baselineCost;
  return {
    baselineCost,
    targetCost,
    delta,
    deltaPct: baselineCost === 0 ? 0 : delta / baselineCost,
  };
}

/**
 * Commitment sizing: find commit monthly $ that minimizes expected effective cost
 * given P50/P90 on-demand and a commit discount + take-or-pay fraction.
 */
export function optimizeCommitment(args: {
  p50Monthly: number;
  p90Monthly: number;
  commitDiscountPct: number;
  /** fraction of commit that is take-or-pay (wasted if unused) */
  takeOrPayFraction?: number;
  candidates?: number[];
}): {
  recommendedCommit: number;
  expectedCost: number;
  breakevenUtilization: number;
  table: { commit: number; expectedCost: number; utilizationAtP50: number }[];
} {
  const {
    p50Monthly,
    p90Monthly,
    commitDiscountPct,
    takeOrPayFraction = 1,
    candidates,
  } = args;

  const levels =
    candidates ??
    [0, 0.5, 0.7, 0.85, 1.0, 1.15].map((f) => Math.round(p50Monthly * f));

  // Expected demand ≈ 0.5*P50 + 0.5*blend toward P90
  const expectedDemand = 0.6 * p50Monthly + 0.4 * p90Monthly;

  const table = levels.map((commit) => {
    const covered = Math.min(expectedDemand, commit);
    const onDemand = Math.max(0, expectedDemand - commit);
    const unused = Math.max(0, commit - expectedDemand) * takeOrPayFraction;
    const discountedCovered = covered * (1 - commitDiscountPct);
    const expectedCost = discountedCovered + onDemand + unused;
    return {
      commit,
      expectedCost,
      utilizationAtP50: commit === 0 ? 0 : Math.min(1, p50Monthly / commit),
    };
  });

  table.sort((a, b) => a.expectedCost - b.expectedCost);
  const best = table[0];
  const breakevenUtilization = commitDiscountPct > 0 ? 1 - commitDiscountPct : 1;

  return {
    recommendedCommit: best.commit,
    expectedCost: best.expectedCost,
    breakevenUtilization,
    table: table.sort((a, b) => a.commit - b.commit),
  };
}

/** Adoption level where spend exceeds monthly budget (binary search on adoption). */
export function adoptionBreakBudget(args: {
  feature: FeatureDrivers;
  priceLines: PriceLine[];
  at: Date;
  monthlyBudget: number;
  maxAdoption?: number;
}): { breakAdoption: number | null; costAtBreak: number } {
  const { feature, priceLines, at, monthlyBudget, maxAdoption = 1 } = args;
  let lo = 0;
  let hi = maxAdoption;
  let breakAdoption: number | null = null;

  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const weekly = featureWeeklyCost(feature, priceLines, at, mid);
    const monthly = weekly * (52 / 12);
    if (monthly > monthlyBudget) {
      breakAdoption = mid;
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const costAtBreak =
    breakAdoption === null
      ? featureWeeklyCost(feature, priceLines, at, maxAdoption) * (52 / 12)
      : featureWeeklyCost(feature, priceLines, at, breakAdoption) * (52 / 12);

  return { breakAdoption, costAtBreak };
}
