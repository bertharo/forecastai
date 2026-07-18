import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import type { AnalyticsFilters, MetricMode } from "@/lib/queries/filters";

function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function valueExpr(metric: MetricMode) {
  if (metric === "consumption") {
    return sql<string>`coalesce(sum(${s.costRecords.consumedQuantity}),0)`;
  }
  if (metric === "adoption") {
    return sql<string>`coalesce(count(distinct ${s.costRecords.tags}->>'feature'),0)`;
  }
  return sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`;
}

export async function getSpendSummary(
  orgId: string,
  filters: AnalyticsFilters | string | undefined = {}
) {
  // Back-compat: second arg used to be dimensionNodeId string
  const f: AnalyticsFilters =
    typeof filters === "string"
      ? { node: filters, metric: "spend" }
      : { metric: "spend", ...filters };

  const metric = f.metric ?? "spend";
  const mtdStart = monthStart();
  const trailingStart = daysAgo(30);
  const value = valueExpr(metric);

  // Subtree roll-up: match node or any descendant whose path is under selected path
  const dimFilter = f.node
    ? sql`exists (
        select 1
        from cost_record_dimensions crd
        join dimension_nodes n on n.id = crd.dimension_node_id
        join dimension_nodes sel on sel.id = ${f.node}
        where crd.cost_record_id = ${s.costRecords.id}
          and (
            n.id = sel.id
            or n.path = sel.path
            or n.path like sel.path || '/%'
          )
      )`
    : sql`true`;

  const providerFilter = f.provider
    ? sql`exists (
        select 1 from providers p
        where p.id = ${s.costRecords.providerId} and p.key = ${f.provider}
      )`
    : sql`true`;

  const modelFilter = f.model
    ? sql`exists (
        select 1 from skus sk
        where sk.id = ${s.costRecords.skuId} and sk.sku_id = ${f.model}
      )`
    : sql`true`;

  const featureFilter = f.feature
    ? sql`${s.costRecords.tags}->>'feature' = ${f.feature}`
    : sql`true`;

  const baseWhere = and(
    eq(s.costRecords.orgId, orgId),
    dimFilter,
    providerFilter,
    modelFilter,
    featureFilter
  );

  const [mtd] = await db
    .select({
      value: value,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
      billed: sql<string>`coalesce(sum(${s.costRecords.billedCost}),0)`,
      qty: sql<string>`coalesce(sum(${s.costRecords.consumedQuantity}),0)`,
    })
    .from(s.costRecords)
    .where(and(baseWhere, gte(s.costRecords.chargePeriodStart, mtdStart)));

  const [trailing] = await db
    .select({
      value: value,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
      qty: sql<string>`coalesce(sum(${s.costRecords.consumedQuantity}),0)`,
    })
    .from(s.costRecords)
    .where(and(baseWhere, gte(s.costRecords.chargePeriodStart, trailingStart)));

  const [alloc] = await db
    .select({
      total: sql<string>`count(*)`,
      allocated: sql<string>`count(*) filter (where ${s.costRecords.allocationStatus} = 'allocated')`,
      totalSpend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
      allocatedSpend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}) filter (where ${s.costRecords.allocationStatus} = 'allocated'),0)`,
    })
    .from(s.costRecords)
    .where(and(baseWhere, gte(s.costRecords.chargePeriodStart, trailingStart)));

  const byProvider = await db
    .select({
      key: s.providers.key,
      name: s.providers.displayName,
      value: value,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .innerJoin(s.providers, eq(s.costRecords.providerId, s.providers.id))
    .where(and(baseWhere, gte(s.costRecords.chargePeriodStart, trailingStart)))
    .groupBy(s.providers.key, s.providers.displayName)
    .orderBy(desc(sql`sum(${s.costRecords.effectiveCost})`));

  const bySku = await db
    .select({
      sku: s.skus.displayName,
      skuId: s.skus.skuId,
      value: value,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .innerJoin(s.skus, eq(s.costRecords.skuId, s.skus.id))
    .where(and(baseWhere, gte(s.costRecords.chargePeriodStart, trailingStart)))
    .groupBy(s.skus.displayName, s.skus.skuId)
    .orderBy(desc(sql`sum(${s.costRecords.effectiveCost})`))
    .limit(12);

  const byFeature = await db
    .select({
      feature: sql<string>`coalesce(${s.costRecords.tags}->>'feature','unallocated')`,
      value: value,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .where(and(baseWhere, gte(s.costRecords.chargePeriodStart, trailingStart)))
    .groupBy(sql`${s.costRecords.tags}->>'feature'`)
    .orderBy(desc(sql`sum(${s.costRecords.effectiveCost})`));

  const byTeam = await db
    .select({
      team: s.dimensionNodes.displayName,
      nodeId: s.dimensionNodes.id,
      value: value,
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
        baseWhere,
        gte(s.costRecords.chargePeriodStart, trailingStart),
        eq(s.dimensionTypes.key, "team")
      )
    )
    .groupBy(s.dimensionNodes.displayName, s.dimensionNodes.id)
    .orderBy(desc(sql`sum(${s.costRecords.effectiveCost})`));

  const daily = await db
    .select({
      day: sql<string>`(${s.costRecords.chargePeriodStart})::date`,
      value: value,
      effective: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
      provider: s.providers.key,
    })
    .from(s.costRecords)
    .innerJoin(s.providers, eq(s.costRecords.providerId, s.providers.id))
    .where(and(baseWhere, gte(s.costRecords.chargePeriodStart, daysAgo(60))))
    .groupBy(sql`(${s.costRecords.chargePeriodStart})::date`, s.providers.key)
    .orderBy(sql`(${s.costRecords.chargePeriodStart})::date`);

  const dayTotals = new Map<string, number>();
  for (const row of daily) {
    dayTotals.set(
      row.day,
      (dayTotals.get(row.day) ?? 0) + Number(row.value ?? row.effective)
    );
  }
  const vals = [...dayTotals.values()];
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const anomalies = [...dayTotals.entries()]
    .filter(([, v]) => mean > 0 && v > mean * 2)
    .map(([day, amount]) => ({ day, amount, vsBaseline: amount / mean }))
    .slice(-5);

  const trailingAmt = Number(trailing.effective);
  const trailingValue = Number(trailing.value);
  const runRate = (trailingAmt / 30) * (365 / 12);

  const totalSpendAlloc = Number(alloc.totalSpend) || 0;
  const allocatedSpend = Number(alloc.allocatedSpend) || 0;
  const allocatedPct =
    totalSpendAlloc > 0 ? allocatedSpend / totalSpendAlloc : 1;

  const [budget] = await db
    .select()
    .from(s.budgets)
    .where(and(eq(s.budgets.orgId, orgId), eq(s.budgets.scopeType, "org")))
    .limit(1);

  return {
    metric,
    mtd: Number(mtd.effective),
    mtdValue: Number(mtd.value),
    mtdBilled: Number(mtd.billed),
    mtdQty: Number(mtd.qty),
    trailing30: trailingAmt,
    trailingValue,
    trailingQty: Number(trailing.qty),
    runRate,
    allocatedPct,
    byProvider: byProvider.map((r) => ({
      key: r.key,
      name: r.name,
      effective: Number(r.effective),
      value: Number(r.value ?? r.effective),
    })),
    bySku: bySku.map((r) => ({
      sku: r.sku,
      skuId: r.skuId,
      effective: Number(r.effective),
      value: Number(r.value ?? r.effective),
    })),
    byFeature: byFeature.map((r) => ({
      feature: r.feature,
      effective: Number(r.effective),
      value: Number(r.value ?? r.effective),
    })),
    byTeam: byTeam.map((r) => ({
      team: r.team,
      nodeId: r.nodeId,
      effective: Number(r.effective),
      value: Number(r.value ?? r.effective),
    })),
    daily,
    anomalies,
    budget: budget
      ? {
          name: budget.name,
          amount: Number(budget.amount),
          mtdPct: Number(mtd.effective) / Number(budget.amount),
        }
      : null,
  };
}

export async function getFilterOptions(orgId: string) {
  const providers = await db
    .select({
      key: s.providers.key,
      name: s.providers.displayName,
    })
    .from(s.costRecords)
    .innerJoin(s.providers, eq(s.costRecords.providerId, s.providers.id))
    .where(eq(s.costRecords.orgId, orgId))
    .groupBy(s.providers.key, s.providers.displayName)
    .orderBy(s.providers.displayName);

  const models = await db
    .select({
      skuId: s.skus.skuId,
      name: s.skus.displayName,
    })
    .from(s.costRecords)
    .innerJoin(s.skus, eq(s.costRecords.skuId, s.skus.id))
    .where(eq(s.costRecords.orgId, orgId))
    .groupBy(s.skus.skuId, s.skus.displayName)
    .orderBy(s.skus.displayName);

  const features = await db
    .select({
      key: sql<string>`${s.costRecords.tags}->>'feature'`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        sql`${s.costRecords.tags}->>'feature' is not null`
      )
    )
    .groupBy(sql`${s.costRecords.tags}->>'feature'`)
    .orderBy(sql`${s.costRecords.tags}->>'feature'`);

  return {
    providers,
    models,
    features: features
      .map((f) => ({ key: f.key }))
      .filter((f) => f.key && f.key !== "null"),
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
