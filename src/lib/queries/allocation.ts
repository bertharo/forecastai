import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export type UnallocatedCluster = {
  id: string;
  spend: number;
  count: number;
  providerKey: string | null;
  providerName: string | null;
  model: string | null;
  feature: string | null;
  apiKey: string | null;
  source: string | null;
  environment: string | null;
  sampleTags: Record<string, string>;
  suggestedMatch: Record<string, string>;
};

/** Cluster unallocated cost by shared attributes, largest first. */
export async function getUnallocatedClusters(
  orgId: string,
  days = 30
): Promise<UnallocatedCluster[]> {
  const since = daysAgo(days);

  const rows = await db
    .select({
      spend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
      count: sql<string>`count(*)`,
      providerKey: s.providers.key,
      providerName: s.providers.displayName,
      model: s.skus.skuId,
      feature: sql<string>`coalesce(${s.costRecords.tags}->>'feature','')`,
      apiKey: sql<string>`coalesce(${s.costRecords.tags}->>'api_key',${s.costRecords.tags}->>'apiKey','')`,
      source: sql<string>`coalesce(${s.costRecords.tags}->>'source','')`,
      environment: sql<string>`coalesce(${s.costRecords.tags}->>'environment','')`,
      sampleTags: sql<Record<string, string>>`(array_agg(${s.costRecords.tags}))[1]`,
    })
    .from(s.costRecords)
    .leftJoin(s.providers, eq(s.costRecords.providerId, s.providers.id))
    .leftJoin(s.skus, eq(s.costRecords.skuId, s.skus.id))
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        eq(s.costRecords.allocationStatus, "unallocated"),
        gte(s.costRecords.chargePeriodStart, since)
      )
    )
    .groupBy(
      s.providers.key,
      s.providers.displayName,
      s.skus.skuId,
      sql`${s.costRecords.tags}->>'feature'`,
      sql`coalesce(${s.costRecords.tags}->>'api_key',${s.costRecords.tags}->>'apiKey','')`,
      sql`${s.costRecords.tags}->>'source'`,
      sql`${s.costRecords.tags}->>'environment'`
    )
    .orderBy(desc(sql`sum(${s.costRecords.effectiveCost})`))
    .limit(40);

  return rows.map((r, i) => {
    const suggestedMatch: Record<string, string> = {};
    if (r.feature) suggestedMatch.feature = r.feature;
    if (r.apiKey) suggestedMatch.api_key = r.apiKey;
    if (r.source) suggestedMatch.source = r.source;
    if (r.environment) suggestedMatch.environment = r.environment;
    if (r.model) suggestedMatch.model = r.model;
    if (r.providerKey) suggestedMatch.provider = r.providerKey;

    return {
      id: [
        r.providerKey ?? "none",
        r.model ?? "none",
        r.feature || "none",
        r.apiKey || "none",
        r.source || "none",
        String(i),
      ].join("|"),
      spend: Number(r.spend),
      count: Number(r.count),
      providerKey: r.providerKey,
      providerName: r.providerName,
      model: r.model,
      feature: r.feature || null,
      apiKey: r.apiKey || null,
      source: r.source || null,
      environment: r.environment || null,
      sampleTags: (r.sampleTags ?? {}) as Record<string, string>,
      suggestedMatch,
    };
  });
}

export async function getAllocationPct(
  orgId: string,
  days = 30
): Promise<{
  allocatedPct: number;
  total: number;
  allocated: number;
  /** Spend-weighted totals (USD). Prefer these over row counts. */
  totalSpend: number;
  allocatedSpend: number;
}> {
  const since = daysAgo(days);
  const [row] = await db
    .select({
      total: sql<string>`count(*)`,
      allocated: sql<string>`count(*) filter (where ${s.costRecords.allocationStatus} = 'allocated')`,
      totalSpend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
      allocatedSpend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}) filter (where ${s.costRecords.allocationStatus} = 'allocated'),0)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, since)
      )
    );
  const total = Number(row?.total) || 0;
  const allocated = Number(row?.allocated) || 0;
  const totalSpend = Number(row?.totalSpend) || 0;
  const allocatedSpend = Number(row?.allocatedSpend) || 0;
  return {
    total,
    allocated,
    totalSpend,
    allocatedSpend,
    // Spend-weighted: $ allocated / $ total (not row count)
    allocatedPct: totalSpend > 0 ? allocatedSpend / totalSpend : 1,
  };
}

/** 30-day daily allocated % for sparkline. */
export async function getAllocationTrend(
  orgId: string,
  days = 30
): Promise<{ day: string; allocatedPct: number }[]> {
  const since = daysAgo(days);
  const rows = await db
    .select({
      day: sql<string>`(${s.costRecords.chargePeriodStart})::date`,
      totalSpend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
      allocatedSpend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}) filter (where ${s.costRecords.allocationStatus} = 'allocated'),0)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, since)
      )
    )
    .groupBy(sql`(${s.costRecords.chargePeriodStart})::date`)
    .orderBy(sql`(${s.costRecords.chargePeriodStart})::date`);

  return rows.map((r) => {
    const totalSpend = Number(r.totalSpend) || 0;
    return {
      day: String(r.day),
      allocatedPct: totalSpend > 0 ? Number(r.allocatedSpend) / totalSpend : 1,
    };
  });
}

/**
 * Per-connector allocation KPI (30d).
 * Cost facts are keyed by provider; join org connectors on providerId.
 */
export async function getAllocationByConnector(orgId: string, days = 30) {
  const since = daysAgo(days);
  return db
    .select({
      connectorId: s.connectors.id,
      providerKey: s.providers.key,
      providerName: s.providers.displayName,
      total: sql<string>`count(*)`,
      allocated: sql<string>`count(*) filter (where ${s.costRecords.allocationStatus} = 'allocated')`,
      spend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .innerJoin(s.providers, eq(s.costRecords.providerId, s.providers.id))
    .innerJoin(
      s.connectors,
      and(
        eq(s.connectors.providerId, s.providers.id),
        eq(s.connectors.orgId, orgId)
      )
    )
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, since)
      )
    )
    .groupBy(s.connectors.id, s.providers.key, s.providers.displayName)
    .orderBy(desc(sql`sum(${s.costRecords.effectiveCost})`));
}
