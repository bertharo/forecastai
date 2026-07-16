import { describe, expect, it } from "vitest";
import {
  adoptionBreakBudget,
  fitDriverMean,
  modelSwitchDelta,
  optimizeCommitment,
  priceAtTime,
  projectAdoption,
  projectForecast,
  type FeatureDrivers,
  type PriceLine,
  type RouteSplit,
} from "./engine";

const t0 = new Date("2025-01-01T00:00:00Z");
const t1 = new Date("2025-07-01T00:00:00Z");

const lines: PriceLine[] = [
  {
    skuId: "claude-sonnet",
    meterKey: "input_tokens",
    unitPrice: 3 / 1_000_000,
    effectiveFrom: t0,
    effectiveTo: t1,
  },
  {
    skuId: "claude-sonnet",
    meterKey: "output_tokens",
    unitPrice: 15 / 1_000_000,
    effectiveFrom: t0,
    effectiveTo: t1,
  },
  // mid-history price cut
  {
    skuId: "claude-sonnet",
    meterKey: "input_tokens",
    unitPrice: 2.5 / 1_000_000,
    effectiveFrom: t1,
    effectiveTo: null,
  },
  {
    skuId: "claude-sonnet",
    meterKey: "output_tokens",
    unitPrice: 12 / 1_000_000,
    effectiveFrom: t1,
    effectiveTo: null,
  },
  {
    skuId: "claude-haiku",
    meterKey: "input_tokens",
    unitPrice: 0.8 / 1_000_000,
    effectiveFrom: t0,
    effectiveTo: null,
  },
  {
    skuId: "claude-haiku",
    meterKey: "output_tokens",
    unitPrice: 4 / 1_000_000,
    effectiveFrom: t0,
    effectiveTo: null,
  },
];

describe("priceAtTime (price card time-travel)", () => {
  it("uses pre-cut price before effective date", () => {
    expect(priceAtTime(lines, "claude-sonnet", "input_tokens", new Date("2025-03-01"))).toBeCloseTo(
      3 / 1_000_000
    );
  });

  it("uses post-cut price after effective date", () => {
    expect(priceAtTime(lines, "claude-sonnet", "input_tokens", new Date("2025-08-01"))).toBeCloseTo(
      2.5 / 1_000_000
    );
  });
});

describe("projectAdoption", () => {
  it("linear ramps from current to target", () => {
    const a0 = projectAdoption(
      { curve: "linear", current: 0.1, target: 0.4, weeksToSaturation: 10 },
      0
    );
    const aMid = projectAdoption(
      { curve: "linear", current: 0.1, target: 0.4, weeksToSaturation: 10 },
      5
    );
    const aEnd = projectAdoption(
      { curve: "linear", current: 0.1, target: 0.4, weeksToSaturation: 10 },
      10
    );
    expect(a0).toBeCloseTo(0.1);
    expect(aMid).toBeCloseTo(0.25);
    expect(aEnd).toBeCloseTo(0.4);
  });

  it("logistic stays within bounds", () => {
    const a = projectAdoption(
      { curve: "logistic", current: 0.1, target: 0.5, weeksToSaturation: 20 },
      10
    );
    expect(a).toBeGreaterThan(0.1);
    expect(a).toBeLessThan(0.5);
  });
});

describe("fitDriverMean", () => {
  it("fits mean and cv", () => {
    const { mean, cv } = fitDriverMean([10, 12, 11, 9, 10]);
    expect(mean).toBeCloseTo(10.4);
    expect(cv).toBeGreaterThan(0);
  });
});

describe("projectForecast", () => {
  it("emits P10 <= P50 <= P90 over horizon", () => {
    const feature: FeatureDrivers = {
      featureKey: "support_copilot",
      weeklyActiveUsers: 1000,
      requestsPerActiveUser: 5,
      adoption: 0.2,
      residualCv: 0.2,
      routes: [
        {
          skuId: "claude-sonnet",
          share: 1,
          avgInputTokens: 2000,
          avgOutputTokens: 500,
        },
      ],
    };
    const days = projectForecast({
      start: new Date("2025-08-01"),
      horizonDays: 30,
      tree: { features: [feature] },
      priceLines: lines,
      adoptionByFeature: {
        support_copilot: {
          curve: "linear",
          current: 0.2,
          target: 0.4,
          weeksToSaturation: 12,
        },
      },
    });
    expect(days).toHaveLength(30);
    for (const d of days) {
      expect(d.p10).toBeLessThanOrEqual(d.p50 + 1e-9);
      expect(d.p50).toBeLessThanOrEqual(d.p90 + 1e-9);
    }
    // adoption ramp should increase spend
    expect(days[29].p50).toBeGreaterThan(days[0].p50);
  });
});

describe("modelSwitchDelta", () => {
  it("shows savings when routing 80% to haiku", () => {
    const baseline: RouteSplit[] = [
      { skuId: "claude-sonnet", share: 1, avgInputTokens: 2000, avgOutputTokens: 500 },
    ];
    const target: RouteSplit[] = [
      { skuId: "claude-haiku", share: 0.8, avgInputTokens: 2000, avgOutputTokens: 500 },
      {
        skuId: "claude-sonnet",
        share: 0.2,
        avgInputTokens: 2000,
        avgOutputTokens: 500,
        verbosityMultiplier: 1,
      },
    ];
    const result = modelSwitchDelta({
      requests: 100_000,
      baselineRoutes: baseline,
      targetRoutes: target,
      priceLines: lines,
      at: new Date("2025-08-15"),
    });
    expect(result.targetCost).toBeLessThan(result.baselineCost);
    expect(result.delta).toBeLessThan(0);
  });
});

describe("optimizeCommitment", () => {
  it("recommends a commit near P50 demand", () => {
    const r = optimizeCommitment({
      p50Monthly: 10_000,
      p90Monthly: 14_000,
      commitDiscountPct: 0.3,
    });
    expect(r.recommendedCommit).toBeGreaterThan(0);
    expect(r.breakevenUtilization).toBeCloseTo(0.7);
  });
});

describe("adoptionBreakBudget", () => {
  it("finds adoption that breaches budget", () => {
    const feature: FeatureDrivers = {
      featureKey: "doc_qa",
      weeklyActiveUsers: 5000,
      requestsPerActiveUser: 10,
      adoption: 0.1,
      routes: [
        {
          skuId: "claude-sonnet",
          share: 1,
          avgInputTokens: 3000,
          avgOutputTokens: 800,
        },
      ],
    };
    const { breakAdoption } = adoptionBreakBudget({
      feature,
      priceLines: lines,
      at: new Date("2025-08-01"),
      monthlyBudget: 500,
    });
    expect(breakAdoption).not.toBeNull();
    expect(breakAdoption!).toBeGreaterThan(0);
    expect(breakAdoption!).toBeLessThanOrEqual(1);
  });
});
