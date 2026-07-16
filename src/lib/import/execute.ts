import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  type ColumnMap,
  type RawRow,
  mappedValue,
  rowContentHash,
} from "@/lib/import/parse";
import { applyAllocationRules } from "@/lib/allocation/apply";

export type ImportError = { row: number; field?: string; message: string };

export async function executeUsageImport(opts: {
  orgId: string;
  batchId: string;
  rows: RawRow[];
  columnMap: ColumnMap;
  sourceKind: "csv" | "jsonl" | "invoice";
}): Promise<{
  written: number;
  skipped: number;
  errored: number;
  errors: ImportError[];
}> {
  const { orgId, batchId, rows, columnMap, sourceKind } = opts;
  const [providers, meters, skus] = await Promise.all([
    db.select().from(s.providers),
    db.select().from(s.meters),
    db.select().from(s.skus),
  ]);

  const providerByKey = new Map(providers.map((p) => [p.key, p]));
  let written = 0;
  let skipped = 0;
  let errored = 0;
  const errors: ImportError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed + header
    try {
      const tsRaw = mappedValue(row, columnMap.timestamp);
      const providerKey = mappedValue(row, columnMap.provider).toLowerCase();
      const model = mappedValue(row, columnMap.model);
      const meterRaw = mappedValue(row, columnMap.meter) || "input_tokens";
      const qtyRaw = mappedValue(row, columnMap.quantity);
      const costRaw = mappedValue(row, columnMap.cost);

      if (!tsRaw) throw Object.assign(new Error("missing timestamp"), { field: "timestamp" });
      if (!providerKey)
        throw Object.assign(new Error("missing provider"), { field: "provider" });
      const qty = Number(qtyRaw);
      if (!Number.isFinite(qty))
        throw Object.assign(new Error("invalid quantity"), { field: "quantity" });

      const provider = providerByKey.get(providerKey);
      if (!provider)
        throw Object.assign(new Error(`unknown provider: ${providerKey}`), {
          field: "provider",
        });

      const eventTime = new Date(tsRaw);
      if (Number.isNaN(eventTime.getTime()))
        throw Object.assign(new Error("invalid timestamp"), { field: "timestamp" });

      let meter = meters.find(
        (m) =>
          m.providerId === provider.id &&
          (m.meterKey === meterRaw ||
            (meterRaw.toLowerCase().includes("input") &&
              m.meterKey === "input_tokens") ||
            (meterRaw.toLowerCase().includes("output") &&
              m.meterKey === "output_tokens"))
      );
      if (!meter) {
        meter = meters.find(
          (m) => m.providerId === provider.id && m.meterKey === "input_tokens"
        );
      }
      if (!meter && sourceKind === "invoice") {
        meter = meters.find(
          (m) => m.providerId === provider.id && m.category === "seat"
        );
      }
      if (!meter)
        throw Object.assign(new Error("no matching meter"), { field: "meter" });

      const sku = skus.find(
        (sk) =>
          sk.providerId === provider.id &&
          (sk.skuId === model ||
            sk.skuId.includes(model) ||
            model.includes(sk.skuId))
      );

      const tags: Record<string, string> = { source: "import" };
      for (const [target, source] of Object.entries(columnMap)) {
        if (target.startsWith("tags.")) {
          const v = mappedValue(row, source);
          if (v) tags[target.slice(5)] = v;
        }
      }

      const hash = rowContentHash(orgId, [
        tsRaw,
        providerKey,
        model,
        meter.meterKey,
        String(qty),
        costRaw,
        tags.feature ?? "",
      ]);

      const [existing] = await db
        .select({ id: s.costRecords.id })
        .from(s.costRecords)
        .where(and(eq(s.costRecords.orgId, orgId), eq(s.costRecords.contentHash, hash)))
        .limit(1);
      if (existing) {
        skipped++;
        continue;
      }

      const alloc = await applyAllocationRules(orgId, tags);
      const cost =
        costRaw && Number.isFinite(Number(costRaw))
          ? Number(costRaw)
          : 0;
      const unitPrice = qty > 0 ? cost / qty : 0;
      const end = new Date(eventTime);
      end.setUTCHours(end.getUTCHours() + 1);

      const [usage] = await db
        .insert(s.usageEvents)
        .values({
          orgId,
          eventTime,
          providerId: provider.id,
          skuId: sku?.id,
          meterId: meter.id,
          consumedQuantity: String(qty),
          consumedUnit: meter.consumedUnit,
          tags,
          allocationStatus: alloc.allocationStatus,
          importBatchId: batchId,
          contentHash: hash,
          chargePeriodStart: eventTime,
          chargePeriodEnd: end,
        })
        .returning({ id: s.usageEvents.id });

      if (alloc.dims.length) {
        await db.insert(s.usageEventDimensions).values(
          alloc.dims.map((d) => ({
            usageEventId: usage.id,
            dimensionTypeId: d.dimensionTypeId,
            dimensionNodeId: d.dimensionNodeId,
          }))
        );
      }

      const [costRow] = await db
        .insert(s.costRecords)
        .values({
          orgId,
          usageEventId: usage.id,
          chargePeriodStart: eventTime,
          chargePeriodEnd: end,
          providerId: provider.id,
          skuId: sku?.id,
          meterId: meter.id,
          serviceName: `${provider.displayName} (import)`,
          focusSkuId: model || null,
          consumedQuantity: String(qty),
          consumedUnit: meter.consumedUnit,
          billedCost: String(cost.toFixed(6)),
          effectiveCost: String(cost.toFixed(6)),
          listUnitPrice: String(unitPrice),
          effectiveUnitPrice: String(unitPrice),
          tags,
          allocationStatus: alloc.allocationStatus,
          importBatchId: batchId,
          contentHash: hash,
        })
        .returning({ id: s.costRecords.id });

      if (alloc.dims.length) {
        await db.insert(s.costRecordDimensions).values(
          alloc.dims.map((d) => ({
            costRecordId: costRow.id,
            dimensionTypeId: d.dimensionTypeId,
            dimensionNodeId: d.dimensionNodeId,
          }))
        );
      }

      written++;
    } catch (e) {
      errored++;
      const err = e as Error & { field?: string };
      errors.push({
        row: rowNum,
        field: err.field,
        message: err.message || String(e),
      });
      if (errors.length > 200) break;
    }
  }

  return { written, skipped, errored, errors };
}

export async function rollbackImportBatch(orgId: string, batchId: string) {
  const [batch] = await db
    .select()
    .from(s.importBatches)
    .where(and(eq(s.importBatches.id, batchId), eq(s.importBatches.orgId, orgId)))
    .limit(1);
  if (!batch) throw new Error("batch not found");
  if (batch.status === "rolled_back") return { ok: true, already: true };

  const costs = await db
    .select({ id: s.costRecords.id })
    .from(s.costRecords)
    .where(eq(s.costRecords.importBatchId, batchId));
  const costIds = costs.map((c) => c.id);
  if (costIds.length) {
    await db
      .delete(s.costRecordDimensions)
      .where(inArray(s.costRecordDimensions.costRecordId, costIds));
    await db.delete(s.costRecords).where(inArray(s.costRecords.id, costIds));
  }

  const usages = await db
    .select({ id: s.usageEvents.id })
    .from(s.usageEvents)
    .where(eq(s.usageEvents.importBatchId, batchId));
  const usageIds = usages.map((u) => u.id);
  if (usageIds.length) {
    await db
      .delete(s.usageEventDimensions)
      .where(inArray(s.usageEventDimensions.usageEventId, usageIds));
    await db.delete(s.usageEvents).where(inArray(s.usageEvents.id, usageIds));
  }

  await db
    .update(s.importBatches)
    .set({ status: "rolled_back", rolledBackAt: new Date() })
    .where(eq(s.importBatches.id, batchId));

  await db.insert(s.auditLogs).values({
    orgId,
    actorLabel: "demo",
    action: "import.rollback",
    entityType: "import_batch",
    entityId: batchId,
    before: { status: batch.status, rowsWritten: batch.rowsWritten },
    after: { status: "rolled_back" },
  });

  return { ok: true, deletedCosts: costIds.length, deletedUsage: usageIds.length };
}

export async function findActiveBatchByHash(orgId: string, hash: string) {
  const [batch] = await db
    .select()
    .from(s.importBatches)
    .where(
      and(
        eq(s.importBatches.orgId, orgId),
        eq(s.importBatches.contentHash, hash),
        ne(s.importBatches.status, "rolled_back"),
        isNull(s.importBatches.rolledBackAt)
      )
    )
    .limit(1);
  return batch;
}

export async function listTemplates(orgId: string) {
  return db
    .select()
    .from(s.mappingTemplates)
    .where(
      sql`${s.mappingTemplates.orgId} = ${orgId} or ${s.mappingTemplates.isSystem} = true`
    );
}
