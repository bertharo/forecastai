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
import {
  parseImportTimestamp,
  resolveProviderKey,
  TELEMETRY_TEMPLATE,
} from "@/lib/import/telemetry";
import { projectCodingToolImportsToAiDaily } from "@/lib/ai-tools/from-import";

export type ImportError = { row: number; field?: string; message: string };

export async function executeUsageImport(opts: {
  orgId: string;
  batchId: string;
  rows: RawRow[];
  columnMap: ColumnMap;
  sourceKind: "csv" | "jsonl" | "invoice";
  /** Chunked callers rebuild the AI-daily projection once at the end instead — see finishBatch in the import API route. */
  skipProjection?: boolean;
}): Promise<{
  written: number;
  skipped: number;
  errored: number;
  errors: ImportError[];
}> {
  const { orgId, batchId, rows, columnMap, sourceKind, skipProjection } = opts;
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
      const providerRaw = mappedValue(row, columnMap.provider);
      const providerKey = resolveProviderKey(providerRaw);
      const model = mappedValue(row, columnMap.model);
      const meterRaw = mappedValue(row, columnMap.meter) || "input_tokens";
      let qtyRaw = mappedValue(row, columnMap.quantity);
      // Accept common spend column typo from telemetry exports
      let costRaw = mappedValue(row, columnMap.cost);
      if (!costRaw) {
        costRaw =
          mappedValue(row, "total_spend_dollars") ||
          mappedValue(row, "total_sepnd_dollars") ||
          mappedValue(row, "total_spend");
      }
      if (!qtyRaw) {
        qtyRaw =
          mappedValue(row, "total_tokens") || mappedValue(row, "tokens") || "";
      }

      if (!tsRaw) throw Object.assign(new Error("missing timestamp"), { field: "timestamp" });
      if (!providerKey)
        throw Object.assign(new Error("missing provider"), { field: "provider" });

      let qty = Number(String(qtyRaw).replace(/,/g, ""));
      if (!Number.isFinite(qty) || qty < 0) {
        // Cost-only telemetry row — keep a unit quantity so the dollar amount lands
        if (costRaw && Number.isFinite(Number(String(costRaw).replace(/[$,]/g, "")))) {
          qty = 1;
        } else {
          throw Object.assign(new Error("invalid quantity"), { field: "quantity" });
        }
      }

      let provider = providerByKey.get(providerKey);
      if (!provider)
        throw Object.assign(new Error(`unknown provider / ai_tool: ${providerRaw || providerKey}`), {
          field: "provider",
        });

      const parsedTs = parseImportTimestamp(tsRaw);
      if (!parsedTs)
        throw Object.assign(new Error("invalid timestamp"), { field: "timestamp" });
      const { start: eventTime, end } = parsedTs;

      // Token meters first; then seat/credit vendors (Perplexity/Replit/Lovable/…).
      // Telemetry CSVs often force meter=input_tokens even when the vendor catalog
      // only has seats/credits — still land the dollar amount on any provider meter.
      const forProvider = meters.filter((m) => m.providerId === provider!.id);
      const meterRawLower = meterRaw.toLowerCase();
      let meter =
        forProvider.find(
          (m) =>
            m.meterKey === meterRaw ||
            (meterRawLower.includes("input") && m.meterKey === "input_tokens") ||
            (meterRawLower.includes("output") &&
              m.meterKey === "output_tokens") ||
            (meterRawLower.includes("token") && m.meterKey === "input_tokens")
        ) ||
        forProvider.find((m) => m.meterKey === "input_tokens") ||
        forProvider.find((m) => m.meterKey === "premium_requests") ||
        forProvider.find((m) => m.meterKey === "seats") ||
        forProvider.find((m) => m.meterKey === "credits") ||
        forProvider.find((m) => m.consumedUnit === "Tokens") ||
        (sourceKind === "invoice"
          ? forProvider.find((m) => m.category === "seat")
          : undefined) ||
        forProvider[0];
      if (!meter)
        throw Object.assign(new Error("no matching meter"), { field: "meter" });

      const sku = skus.find(
        (sk) =>
          sk.providerId === provider!.id &&
          model &&
          (sk.skuId === model ||
            sk.skuId.includes(model) ||
            model.includes(sk.skuId))
      );

      const tags: Record<string, string> = { source: "import" };
      for (const [target, source] of Object.entries(columnMap)) {
        if (target.startsWith("tags.")) {
          const tagKey = target.slice(5);
          // Department never comes from usage CSV — join roster or key registry only
          if (tagKey === "department") continue;
          const v = mappedValue(row, source);
          if (!v) continue;
          tags[tagKey] =
            tagKey === "email" || tagKey === "user_email"
              ? v.trim().toLowerCase()
              : v;
        }
      }
      // Preserve original tool label when provider was derived from ai_tool
      if (providerRaw && !tags.ai_tool) {
        tags.ai_tool = providerRaw;
      }
      // Cursor/Perplexity catalogs may lack token meters; keep raw token counts for AI Cost.
      if (Number.isFinite(qty) && qty > 0 && !tags.total_tokens) {
        const looksLikeTokens =
          meterRawLower.includes("token") ||
          meter.consumedUnit.toLowerCase() === "tokens" ||
          Boolean(qtyRaw);
        if (looksLikeTokens) tags.total_tokens = String(qty);
      }

      const cost =
        costRaw && Number.isFinite(Number(String(costRaw).replace(/[$,]/g, "")))
          ? Number(String(costRaw).replace(/[$,]/g, ""))
          : 0;

      const hash = rowContentHash(orgId, [
        tsRaw,
        provider.key,
        model,
        meter.meterKey,
        String(qty),
        String(cost),
        tags.email ?? "",
        tags.ai_tool ?? "",
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
      const unitPrice = qty > 0 ? cost / qty : 0;

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

  // AI Cost reads ai_tool_daily (connector sync). Project coding-tool import
  // rows into the same grain so person/team views stay filled.
  if (written > 0 && !skipProjection) {
    await projectCodingToolImportsToAiDaily(orgId);
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

  // Rebuild AI Cost grains from remaining import cost_records
  await projectCodingToolImportsToAiDaily(orgId);

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

/** A chunked upload stuck at "importing" longer than this was abandoned (closed tab, dead network). */
const STALE_IMPORTING_MINUTES = 20;

/**
 * Successful (or in-progress) batch for this file hash — failed uploads do
 * not block retry. A chunked upload can leave a batch at "importing" for as
 * long as the browser takes to send every chunk; if that status has sat
 * stale past STALE_IMPORTING_MINUTES, treat it as abandoned (mark it
 * "failed" so it stops blocking) rather than letting it block re-uploads of
 * the same file forever.
 */
export async function findActiveBatchByHash(orgId: string, hash: string) {
  const [batch] = await db
    .select()
    .from(s.importBatches)
    .where(
      and(
        eq(s.importBatches.orgId, orgId),
        eq(s.importBatches.contentHash, hash),
        ne(s.importBatches.status, "rolled_back"),
        ne(s.importBatches.status, "failed"),
        isNull(s.importBatches.rolledBackAt)
      )
    )
    .limit(1);

  if (batch?.status === "importing") {
    const ageMinutes = (Date.now() - batch.createdAt.getTime()) / 60_000;
    if (ageMinutes > STALE_IMPORTING_MINUTES) {
      await db
        .update(s.importBatches)
        .set({ status: "failed" })
        .where(eq(s.importBatches.id, batch.id));
      return undefined;
    }
  }

  return batch;
}

export async function listTemplates(orgId: string) {
  await ensureTelemetryMappingTemplate();
  return db
    .select()
    .from(s.mappingTemplates)
    .where(
      sql`${s.mappingTemplates.orgId} = ${orgId} or ${s.mappingTemplates.isSystem} = true`
    );
}

async function ensureTelemetryMappingTemplate() {
  const [existing] = await db
    .select({ id: s.mappingTemplates.id })
    .from(s.mappingTemplates)
    .where(
      and(
        eq(s.mappingTemplates.isSystem, true),
        eq(s.mappingTemplates.sourceFormat, TELEMETRY_TEMPLATE.sourceFormat)
      )
    )
    .limit(1);
  if (existing) return;
  await db.insert(s.mappingTemplates).values({
    orgId: null,
    providerId: null,
    name: TELEMETRY_TEMPLATE.name,
    sourceFormat: TELEMETRY_TEMPLATE.sourceFormat,
    isSystem: true,
    columnMap: TELEMETRY_TEMPLATE.columnMap,
    sampleHeaders: TELEMETRY_TEMPLATE.sampleHeaders,
  });
}
