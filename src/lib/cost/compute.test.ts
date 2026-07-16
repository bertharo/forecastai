import { describe, expect, it } from "vitest";
import { computeCostRecord, resolvePriceLine, type PriceCardLineLookup } from "./compute";

const lines: PriceCardLineLookup[] = [
  {
    id: "l1",
    priceCardId: "c1",
    skuId: "sku-sonnet",
    meterId: "m-in",
    meterKey: "input_tokens",
    unitPrice: 3 / 1e6,
    discountPct: 0,
    effectiveFrom: new Date("2025-01-01"),
    effectiveTo: new Date("2025-07-01"),
    source: "published",
  },
  {
    id: "l2",
    priceCardId: "c2",
    skuId: "sku-sonnet",
    meterId: "m-in",
    meterKey: "input_tokens",
    unitPrice: 2 / 1e6,
    discountPct: 0,
    effectiveFrom: new Date("2025-07-01"),
    effectiveTo: null,
    source: "published",
  },
];

describe("resolvePriceLine", () => {
  it("time-travels to the card in effect", () => {
    const early = resolvePriceLine(lines, "sku-sonnet", "m-in", new Date("2025-03-01"));
    const late = resolvePriceLine(lines, "sku-sonnet", "m-in", new Date("2025-08-01"));
    expect(early?.id).toBe("l1");
    expect(late?.id).toBe("l2");
  });
});

describe("computeCostRecord", () => {
  it("computes billed vs effective cost", () => {
    const cost = computeCostRecord(
      {
        id: "e1",
        eventTime: new Date("2025-03-15"),
        providerId: "p1",
        skuId: "sku-sonnet",
        meterId: "m-in",
        meterKey: "input_tokens",
        consumedQuantity: 1_000_000,
        consumedUnit: "Tokens",
        serviceName: "Claude API",
        focusSkuId: "claude-sonnet",
        tags: { feature: "support_copilot" },
        allocationStatus: "allocated",
      },
      lines
    );
    expect(cost.billedCost).toBeCloseTo(3);
    expect(cost.effectiveCost).toBeCloseTo(3);
    expect(cost.priceCardLineId).toBe("l1");
  });
});
