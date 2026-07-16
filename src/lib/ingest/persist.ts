import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  computeCostRecord,
  type PriceCardLineLookup,
} from "@/lib/cost/compute";
import { applyAllocationRules } from "@/lib/allocation/apply";
import type { NormalizedUsageEvent } from "@/lib/connectors/types";

async function loadPriceLines(): Promise<PriceCardLineLookup[]> {
  const rows = await db
    .select({
      id: s.priceCardLines.id,
      priceCardId: s.priceCardLines.priceCardId,
      skuId: s.priceCardLines.skuId,
      meterId: s.priceCardLines.meterId,
      unitPrice: s.priceCardLines.unitPrice,
      discountPct: s.priceCardLines.discountPct,
      effectiveFrom: s.priceCards.effectiveFrom,
      effectiveTo: s.priceCards.effectiveTo,
      source: s.priceCards.source,
      meterKey: s.meters.meterKey,
    })
    .from(s.priceCardLines)
    .innerJoin(s.priceCards, eq(s.priceCardLines.priceCardId, s.priceCards.id))
    .innerJoin(s.meters, eq(s.priceCardLines.meterId, s.meters.id));

  return rows.map((r) => ({
    id: r.id,
    priceCardId: r.priceCardId,
    skuId: r.skuId,
    meterId: r.meterId,
    meterKey: r.meterKey,
    unitPrice: Number(r.unitPrice),
    discountPct: r.discountPct != null ? Number(r.discountPct) : null,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    source: r.source,
  }));
}

/**
 * Persist normalized usage events as usage_events + cost_records + dimension junctions.
 */
export async function persistUsageEvents(
  orgId: string,
  events: NormalizedUsageEvent[]
): Promise<{ written: number; costed: number; allocated: number }> {
  const [providers, meters, skus, lines] = await Promise.all([
    db.select().from(s.providers),
    db.select().from(s.meters),
    db.select().from(s.skus),
    loadPriceLines(),
  ]);

  let written = 0;
  let costed = 0;
  let allocated = 0;

  for (const ev of events) {
    const provider = providers.find((p) => p.key === ev.providerKey);
    if (!provider) continue;
    const meter = meters.find(
      (m) => m.providerId === provider.id && m.meterKey === ev.meterKey
    );
    if (!meter) continue;
    const sku = skus.find(
      (sk) =>
        sk.providerId === provider.id &&
        (sk.skuId === ev.skuId ||
          sk.skuId.includes(String(ev.skuId)) ||
          String(ev.skuId).includes(sk.skuId))
    );

    const alloc = await applyAllocationRules(orgId, ev.tags ?? {});

    const [usageRow] = await db
      .insert(s.usageEvents)
      .values({
        orgId,
        eventTime: ev.eventTime,
        providerId: provider.id,
        skuId: sku?.id,
        meterId: meter.id,
        consumedQuantity: String(ev.consumedQuantity),
        consumedUnit: ev.consumedUnit,
        tags: ev.tags ?? {},
        allocationStatus: alloc.allocationStatus,
        chargePeriodStart: ev.eventTime,
        chargePeriodEnd: ev.eventTime,
      })
      .returning({ id: s.usageEvents.id });

    written++;

    if (alloc.dims.length > 0) {
      await db.insert(s.usageEventDimensions).values(
        alloc.dims.map((d) => ({
          usageEventId: usageRow.id,
          dimensionTypeId: d.dimensionTypeId,
          dimensionNodeId: d.dimensionNodeId,
        }))
      );
      allocated++;
    }

    const computed = computeCostRecord(
      {
        id: usageRow.id,
        eventTime: ev.eventTime,
        providerId: provider.id,
        skuId: sku?.id ?? null,
        meterId: meter.id,
        meterKey: meter.meterKey,
        consumedQuantity: ev.consumedQuantity,
        consumedUnit: ev.consumedUnit,
        serviceName: ev.serviceName ?? `${ev.providerKey} (OTel)`,
        focusSkuId: ev.skuId ?? null,
        tags: ev.tags ?? {},
        allocationStatus: alloc.allocationStatus,
      },
      lines
    );

    const [costRow] = await db
      .insert(s.costRecords)
      .values({
        orgId,
        usageEventId: usageRow.id,
        chargePeriodStart: computed.chargePeriodStart,
        chargePeriodEnd: computed.chargePeriodEnd,
        providerId: computed.providerId,
        skuId: computed.skuId,
        meterId: computed.meterId,
        serviceName: computed.serviceName,
        focusSkuId: computed.focusSkuId,
        consumedQuantity: String(computed.consumedQuantity),
        consumedUnit: computed.consumedUnit,
        billedCost: String(computed.billedCost.toFixed(6)),
        effectiveCost: String(computed.effectiveCost.toFixed(6)),
        listUnitPrice: String(computed.listUnitPrice),
        effectiveUnitPrice: String(computed.effectiveUnitPrice),
        priceCardId: computed.priceCardId,
        priceCardLineId: computed.priceCardLineId,
        tags: computed.tags,
        allocationStatus: computed.allocationStatus,
      })
      .returning({ id: s.costRecords.id });

    costed++;

    if (alloc.dims.length > 0) {
      await db.insert(s.costRecordDimensions).values(
        alloc.dims.map((d) => ({
          costRecordId: costRow.id,
          dimensionTypeId: d.dimensionTypeId,
          dimensionNodeId: d.dimensionNodeId,
        }))
      );
    }
  }

  return { written, costed, allocated };
}
