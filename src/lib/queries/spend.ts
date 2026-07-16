import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, gte, lt, sql, desc } from "drizzle-orm";

function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function getSpendSummary(orgId: string, dimensionNodeId?: string) {
  const mtdStart = monthStart();
  const trailingStart = daysAgo(30);

  const dimFilter = dimensionNodeId
    ? sql`exists (
        select 1 from cost_record_dimensions crd
        where crd.cost_record_id = ${s.costRecords.id}
          and crd.dimension_node_id = ${dimensionNodeId}
      )`
    : sql`true`;

  const [mtd] = await db
    .select({
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
      billed: sql<string>`coalesce(sum(${s.costRecords.billedCost}),0)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, mtdStart),
        dimFilter
      )
    );

  const [trailing] = await db
    .select({
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, trailingStart),
        dimFilter
      )
    );

  const [alloc] = await db
    .select({
      total: sql<string>`count(*)`,
      allocated: sql<string>`count(*) filter (where ${s.costRecords.allocationStatus} = 'allocated')`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, trailingStart),
        dimFilter
      )
    );

  const byProvider = await db
    .select({
      key: s.providers.key,
      name: s.providers.displayName,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .innerJoin(s.providers, eq(s.costRecords.providerId, s.providers.id))
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, trailingStart),
        dimFilter
      )
    )
    .groupBy(s.providers.key, s.providers.displayName)
    .orderBy(desc(sql`sum(${s.costRecords.effectiveCost})`));

  const bySku = await db
    .select({
      sku: s.skus.displayName,
      skuId: s.skus.skuId,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .innerJoin(s.skus, eq(s.costRecords.skuId, s.skus.id))
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, trailingStart),
        dimFilter
      )
    )
    .groupBy(s.skus.displayName, s.skus.skuId)
    .orderBy(desc(sql`sum(${s.costRecords.effectiveCost})`))
    .limit(12);

  const byFeature = await db
    .select({
      feature: sql<string>`coalesce(${s.costRecords.tags}->>'feature','unallocated')`,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, trailingStart),
        dimFilter
      )
    )
    .groupBy(sql`${s.costRecords.tags}->>'feature'`)
    .orderBy(desc(sql`sum(${s.costRecords.effectiveCost})`));

  const byTeam = await db
    .select({
      team: s.dimensionNodes.displayName,
      nodeId: s.dimensionNodes.id,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .innerJoin(
      s.costRecordDimensions,
      eq(s.costRecordDimensions.costRecordId, s.costRecords.id)
    )
    .innerJoin(
      s.dimensionNodes,
      eq(s.costRecordDimensions.dimensionNodeId, s.dimensionNodes.id)
    )
    .innerJoin(
      s.dimensionTypes,
      eq(s.dimensionNodes.dimensionTypeId, s.dimensionTypes.id)
    )
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, trailingStart),
        eq(s.dimensionTypes.key, "team"),
        dimFilter
      )
    )
    .groupBy(s.dimensionNodes.displayName, s.dimensionNodes.id)
    .orderBy(desc(sql`sum(${s.costRecords.effectiveCost})`));

  // Daily series for chart
  const daily = await db
    .select({
      day: sql<string>`(${s.costRecords.chargePeriodStart})::date`,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
      provider: s.providers.key,
    })
    .from(s.costRecords)
    .innerJoin(s.providers, eq(s.costRecords.providerId, s.providers.id))
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, daysAgo(60)),
        dimFilter
      )
    )
    .groupBy(sql`(${s.costRecords.chargePeriodStart})::date`, s.providers.key)
    .orderBy(sql`(${s.costRecords.chargePeriodStart})::date`);

  // Simple anomaly: days > 2x trailing mean
  const dayTotals = new Map<string, number>();
  for (const row of daily) {
    dayTotals.set(row.day, (dayTotals.get(row.day) ?? 0) + Number(row.effective));
  }
  const vals = [...dayTotals.values()];
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const anomalies = [...dayTotals.entries()]
    .filter(([, v]) => mean > 0 && v > mean * 2)
    .map(([day, amount]) => ({ day, amount, vsBaseline: amount / mean }))
    .slice(-5);

  const trailingAmt = Number(trailing.effective);
  const runRate = (trailingAmt / 30) * (365 / 12);

  const totalRows = Number(alloc.total) || 1;
  const allocatedPct = Number(alloc.allocated) / totalRows;

  const [budget] = await db
    .select()
    .from(s.budgets)
    .where(and(eq(s.budgets.orgId, orgId), eq(s.budgets.scopeType, "org")))
    .limit(1);

  return {
    mtd: Number(mtd.effective),
    mtdBilled: Number(mtd.billed),
    trailing30: trailingAmt,
    runRate,
    allocatedPct,
    byProvider: byProvider.map((r) => ({ ...r, effective: Number(r.effective) })),
    bySku: bySku.map((r) => ({ ...r, effective: Number(r.effective) })),
    byFeature: byFeature.map((r) => ({ ...r, effective: Number(r.effective) })),
    byTeam: byTeam.map((r) => ({ ...r, effective: Number(r.effective) })),
    daily,
    anomalies,
    budget: budget
      ? { name: budget.name, amount: Number(budget.amount), mtdPct: Number(mtd.effective) / Number(budget.amount) }
      : null,
  };
}

export async function getSeatUtilization(orgId: string) {
  return db
    .select({
      asOf: s.seatSnapshots.asOf,
      purchased: s.seatSnapshots.seatsPurchased,
      active: s.seatSnapshots.seatsActive,
      heavy: s.seatSnapshots.seatsHeavy,
      provider: s.providers.displayName,
    })
    .from(s.seatSnapshots)
    .innerJoin(s.providers, eq(s.seatSnapshots.providerId, s.providers.id))
    .where(eq(s.seatSnapshots.orgId, orgId))
    .orderBy(desc(s.seatSnapshots.asOf))
    .limit(8);
}
