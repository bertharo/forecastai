/**
 * Cost computation: UsageEvent × PriceCard → CostRecord fields (FOCUS-aligned).
 */

export interface PriceCardLineLookup {
  id: string;
  priceCardId: string;
  skuId: string | null;
  meterId: string;
  meterKey: string;
  unitPrice: number;
  discountPct: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  source: string;
}

export interface UsageForCost {
  id: string;
  eventTime: Date;
  providerId: string;
  skuId: string | null;
  meterId: string;
  meterKey: string;
  consumedQuantity: number;
  consumedUnit: string;
  serviceName: string;
  focusSkuId: string | null;
  tags: Record<string, string>;
  allocationStatus: string;
}

export interface ComputedCost {
  usageEventId: string;
  chargePeriodStart: Date;
  chargePeriodEnd: Date;
  providerId: string;
  skuId: string | null;
  meterId: string;
  serviceName: string;
  focusSkuId: string | null;
  consumedQuantity: number;
  consumedUnit: string;
  billedCost: number;
  effectiveCost: number;
  listUnitPrice: number;
  effectiveUnitPrice: number;
  priceCardId: string | null;
  priceCardLineId: string | null;
  tags: Record<string, string>;
  allocationStatus: string;
}

/**
 * Resolve the price card line in effect at event time.
 * Org negotiated cards (source=negotiated) win over published when both match.
 */
export function resolvePriceLine(
  lines: PriceCardLineLookup[],
  skuId: string | null,
  meterId: string,
  at: Date
): PriceCardLineLookup | null {
  const inWindow = lines.filter(
    (l) =>
      l.meterId === meterId &&
      (l.skuId === null || l.skuId === skuId) &&
      l.effectiveFrom.getTime() <= at.getTime() &&
      (l.effectiveTo === null || l.effectiveTo.getTime() > at.getTime())
  );
  if (inWindow.length === 0) return null;

  inWindow.sort((a, b) => {
    const sourceRank = (s: string) =>
      s === "negotiated" ? 0 : s === "scenario" ? 2 : 1;
    const sr = sourceRank(a.source) - sourceRank(b.source);
    if (sr !== 0) return sr;
    // prefer sku-specific over meter-only
    const skuRank = (l: PriceCardLineLookup) => (l.skuId ? 0 : 1);
    const sk = skuRank(a) - skuRank(b);
    if (sk !== 0) return sk;
    return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
  });

  return inWindow[0];
}

export function computeCostRecord(
  usage: UsageForCost,
  lines: PriceCardLineLookup[],
  negotiatedDiscountPct = 0
): ComputedCost {
  const line = resolvePriceLine(lines, usage.skuId, usage.meterId, usage.eventTime);
  const listUnitPrice = line?.unitPrice ?? 0;
  const lineDiscount = line?.discountPct ?? 0;
  const effectiveUnitPrice =
    listUnitPrice * (1 - lineDiscount) * (1 - negotiatedDiscountPct);

  const billedCost = usage.consumedQuantity * listUnitPrice;
  const effectiveCost = usage.consumedQuantity * effectiveUnitPrice;

  const end = new Date(usage.eventTime);
  end.setUTCHours(end.getUTCHours() + 1);

  return {
    usageEventId: usage.id,
    chargePeriodStart: usage.eventTime,
    chargePeriodEnd: end,
    providerId: usage.providerId,
    skuId: usage.skuId,
    meterId: usage.meterId,
    serviceName: usage.serviceName,
    focusSkuId: usage.focusSkuId,
    consumedQuantity: usage.consumedQuantity,
    consumedUnit: usage.consumedUnit,
    billedCost,
    effectiveCost,
    listUnitPrice,
    effectiveUnitPrice,
    priceCardId: line?.priceCardId ?? null,
    priceCardLineId: line?.id ?? null,
    tags: usage.tags,
    allocationStatus: usage.allocationStatus,
  };
}

export function computeMany(
  usages: UsageForCost[],
  lines: PriceCardLineLookup[]
): ComputedCost[] {
  return usages.map((u) => computeCostRecord(u, lines));
}
