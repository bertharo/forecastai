import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  computeCostRecord,
  type PriceCardLineLookup,
} from "@/lib/cost/compute";
import { applyAllocationRules } from "@/lib/allocation/apply";
import type { NormalizedUsageEvent } from "@/lib/connectors/types";
import { usageEventContentHash } from "@/lib/ingest/contentHash";
import { enrichTagsFromKeyRegistry } from "@/lib/keys/registry";

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

async function replaceUsageDims(
  usageEventId: string,
  dims: { dimensionTypeId: string; dimensionNodeId: string }[]
) {
  await db
    .delete(s.usageEventDimensions)
    .where(eq(s.usageEventDimensions.usageEventId, usageEventId));
  if (dims.length) {
    await db.insert(s.usageEventDimensions).values(
      dims.map((d) => ({
        usageEventId,
        dimensionTypeId: d.dimensionTypeId,
        dimensionNodeId: d.dimensionNodeId,
      }))
    );
  }
}

async function replaceCostDims(
  costRecordId: string,
  dims: { dimensionTypeId: string; dimensionNodeId: string }[]
) {
  await db
    .delete(s.costRecordDimensions)
    .where(eq(s.costRecordDimensions.costRecordId, costRecordId));
  if (dims.length) {
    await db.insert(s.costRecordDimensions).values(
      dims.map((d) => ({
        costRecordId,
        dimensionTypeId: d.dimensionTypeId,
        dimensionNodeId: d.dimensionNodeId,
      }))
    );
  }
}

/**
 * Persist normalized usage events as usage_events + cost_records + dimension junctions.
 * Admin-sourced rows with a content hash upsert so cron re-syncs do not duplicate.
 */
export async function persistUsageEvents(
  orgId: string,
  events: NormalizedUsageEvent[]
): Promise<{ written: number; costed: number; allocated: number; upserted: number }> {
  const [providers, meters, skus, lines] = await Promise.all([
    db.select().from(s.providers),
    db.select().from(s.meters),
    db.select().from(s.skus),
    loadPriceLines(),
  ]);

  let written = 0;
  let costed = 0;
  let allocated = 0;
  let upserted = 0;

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

    const tags = await enrichTagsFromKeyRegistry(orgId, ev.tags ?? {});
    const alloc = await applyAllocationRules(orgId, tags);
    const contentHash = usageEventContentHash(orgId, { ...ev, tags });

    let usageId: string;
    if (contentHash) {
      const [existing] = await db
        .select({ id: s.usageEvents.id })
        .from(s.usageEvents)
        .where(
          and(
            eq(s.usageEvents.orgId, orgId),
            eq(s.usageEvents.contentHash, contentHash)
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(s.usageEvents)
          .set({
            eventTime: ev.eventTime,
            skuId: sku?.id,
            meterId: meter.id,
            consumedQuantity: String(ev.consumedQuantity),
            consumedUnit: ev.consumedUnit,
            tags,
            allocationStatus: alloc.allocationStatus,
            chargePeriodStart: ev.eventTime,
            chargePeriodEnd: ev.eventTime,
            requestId: ev.requestId ?? null,
          })
          .where(eq(s.usageEvents.id, existing.id));
        usageId = existing.id;
        await replaceUsageDims(usageId, alloc.dims);
        upserted++;
        written++;
      } else {
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
            tags,
            allocationStatus: alloc.allocationStatus,
            chargePeriodStart: ev.eventTime,
            chargePeriodEnd: ev.eventTime,
            contentHash,
            requestId: ev.requestId ?? null,
          })
          .returning({ id: s.usageEvents.id });
        usageId = usageRow.id;
        written++;
        if (alloc.dims.length > 0) {
          await replaceUsageDims(usageId, alloc.dims);
        }
      }
    } else {
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
          tags,
          allocationStatus: alloc.allocationStatus,
          chargePeriodStart: ev.eventTime,
          chargePeriodEnd: ev.eventTime,
          requestId: ev.requestId ?? null,
        })
        .returning({ id: s.usageEvents.id });
      usageId = usageRow.id;
      written++;
      if (alloc.dims.length > 0) {
        await replaceUsageDims(usageId, alloc.dims);
      }
    }

    if (alloc.dims.length > 0) allocated++;

    const computed = computeCostRecord(
      {
        id: usageId,
        eventTime: ev.eventTime,
        providerId: provider.id,
        skuId: sku?.id ?? null,
        meterId: meter.id,
        meterKey: meter.meterKey,
        consumedQuantity: ev.consumedQuantity,
        consumedUnit: ev.consumedUnit,
        serviceName: ev.serviceName ?? `${ev.providerKey} (OTel)`,
        focusSkuId: ev.skuId ?? null,
        tags,
        allocationStatus: alloc.allocationStatus,
      },
      lines
    );

    const costValues = {
      orgId,
      usageEventId: usageId,
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
      contentHash: contentHash,
    };

    let costId: string;
    if (contentHash) {
      const [existingCost] = await db
        .select({ id: s.costRecords.id })
        .from(s.costRecords)
        .where(
          and(
            eq(s.costRecords.orgId, orgId),
            eq(s.costRecords.contentHash, contentHash)
          )
        )
        .limit(1);
      if (existingCost) {
        await db
          .update(s.costRecords)
          .set(costValues)
          .where(eq(s.costRecords.id, existingCost.id));
        costId = existingCost.id;
        await replaceCostDims(costId, alloc.dims);
      } else {
        const [costRow] = await db
          .insert(s.costRecords)
          .values(costValues)
          .returning({ id: s.costRecords.id });
        costId = costRow.id;
        if (alloc.dims.length > 0) {
          await replaceCostDims(costId, alloc.dims);
        }
      }
    } else {
      const [costRow] = await db
        .insert(s.costRecords)
        .values(costValues)
        .returning({ id: s.costRecords.id });
      costId = costRow.id;
      if (alloc.dims.length > 0) {
        await replaceCostDims(costId, alloc.dims);
      }
    }

    costed++;
    void costId;
  }

  return { written, costed, allocated, upserted };
}
