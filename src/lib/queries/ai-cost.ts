import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, gte, lt, lte, sql, desc } from "drizzle-orm";
import { computeMetric, type MetricResult } from "@/lib/metrics/compute";
import {
  needsCodingToolImportProjection,
  projectCodingToolImportsToAiDaily,
} from "@/lib/ai-tools/from-import";
import { resolveDashboardPeriod } from "@/lib/queries/period";

export async function getAiCostSummary(
  orgId: string,
  opts?: { days?: number; teamNodeId?: string | null; toolKey?: string | null }
) {
  const days = opts?.days ?? 30;
  // Same grain-aware window as Brief / FinOps.
  const period = await resolveDashboardPeriod(orgId, days);
  const from = period.start.toISOString().slice(0, 10);
  const to = new Date(period.end.getTime() - 1).toISOString().slice(0, 10);

  // Spreadsheet imports historically wrote cost_records only. Project orphaned
  // coding-tool rows into ai_tool_daily so AI Cost matches connector syncs.
  if (await needsCodingToolImportProjection(orgId)) {
    await projectCodingToolImportsToAiDaily(orgId);
  }

  const filters = [
    eq(s.aiToolDaily.orgId, orgId),
    gte(s.aiToolDaily.day, from),
    lte(s.aiToolDaily.day, to),
  ];
  if (opts?.toolKey) filters.push(eq(s.aiToolDaily.toolKey, opts.toolKey));
  if (opts?.teamNodeId) {
    filters.push(
      sql`exists (
        select 1 from dimension_nodes n
        join dimension_nodes sel on sel.id = ${opts.teamNodeId}
        where n.id = ${s.aiToolDaily.dimensionNodeId}
          and (n.id = sel.id or n.path = sel.path or n.path like sel.path || '/%')
      )`
    );
  }

  const [agg] = await db
    .select({
      spend: sql<string>`coalesce(sum(${s.aiToolDaily.spend}),0)`,
      tokens: sql<string>`coalesce(sum(${s.aiToolDaily.tokensTotal}),0)`,
      sessions: sql<string>`coalesce(sum(${s.aiToolDaily.sessions}),0)`,
      contributors: sql<string>`count(distinct ${s.aiToolDaily.contributorId})`,
    })
    .from(s.aiToolDaily)
    .where(and(...filters));

  const byTool = await db
    .select({
      toolKey: s.aiToolDaily.toolKey,
      spend: sql<string>`coalesce(sum(${s.aiToolDaily.spend}),0)`,
      tokens: sql<string>`coalesce(sum(${s.aiToolDaily.tokensTotal}),0)`,
    })
    .from(s.aiToolDaily)
    .where(and(...filters))
    .groupBy(s.aiToolDaily.toolKey)
    .orderBy(desc(sql`sum(${s.aiToolDaily.spend})`));

  const byContributor = await db
    .select({
      contributorId: s.contributors.id,
      email: s.contributors.email,
      name: s.contributors.displayName,
      team: s.dimensionNodes.displayName,
      spend: sql<string>`coalesce(sum(${s.aiToolDaily.spend}),0)`,
      tokens: sql<string>`coalesce(sum(${s.aiToolDaily.tokensTotal}),0)`,
    })
    .from(s.aiToolDaily)
    .innerJoin(s.contributors, eq(s.aiToolDaily.contributorId, s.contributors.id))
    .leftJoin(
      s.dimensionNodes,
      eq(s.aiToolDaily.dimensionNodeId, s.dimensionNodes.id)
    )
    .where(and(...filters))
    .groupBy(
      s.contributors.id,
      s.contributors.email,
      s.contributors.displayName,
      s.dimensionNodes.displayName
    )
    .orderBy(desc(sql`sum(${s.aiToolDaily.spend})`))
    .limit(40);

  const byTeam = await db
    .select({
      nodeId: s.dimensionNodes.id,
      team: s.dimensionNodes.displayName,
      spend: sql<string>`coalesce(sum(${s.aiToolDaily.spend}),0)`,
      tokens: sql<string>`coalesce(sum(${s.aiToolDaily.tokensTotal}),0)`,
    })
    .from(s.aiToolDaily)
    .innerJoin(
      s.dimensionNodes,
      eq(s.aiToolDaily.dimensionNodeId, s.dimensionNodes.id)
    )
    .where(and(...filters))
    .groupBy(s.dimensionNodes.id, s.dimensionNodes.displayName)
    .orderBy(desc(sql`sum(${s.aiToolDaily.spend})`));

  const daily = await db
    .select({
      day: s.aiToolDaily.day,
      toolKey: s.aiToolDaily.toolKey,
      spend: sql<string>`coalesce(sum(${s.aiToolDaily.spend}),0)`,
    })
    .from(s.aiToolDaily)
    .where(and(...filters))
    .groupBy(s.aiToolDaily.day, s.aiToolDaily.toolKey)
    .orderBy(s.aiToolDaily.day);

  const prWhere = and(
    eq(s.pullRequests.orgId, orgId),
    gte(s.pullRequests.mergedAt, period.start),
    lt(s.pullRequests.mergedAt, period.end),
    sql`${s.pullRequests.mergedAt} is not null`
  );

  const [prAgg] = await db
    .select({
      merged: sql<string>`count(*)`,
    })
    .from(s.pullRequests)
    .where(prWhere);

  const prByTeam = await db
    .select({
      nodeId: s.contributors.dimensionNodeId,
      merged: sql<string>`count(*)`,
    })
    .from(s.pullRequests)
    .innerJoin(s.contributors, eq(s.pullRequests.authorContributorId, s.contributors.id))
    .where(prWhere)
    .groupBy(s.contributors.dimensionNodeId);

  const mergedPrsByTeam = new Map<string, number>();
  for (const r of prByTeam) {
    if (r.nodeId) mergedPrsByTeam.set(r.nodeId, Number(r.merged));
  }

  const spend = Number(agg?.spend ?? 0);
  const mergedPrs = Number(prAgg?.merged ?? 0);
  const costPerPrMetric: MetricResult = computeMetric({
    formula: "AI spend ÷ merged PRs",
    value: mergedPrs > 0 ? spend / mergedPrs : 0,
    inputs: [
      { name: "ai_spend", value: spend, unit: "USD" },
      { name: "merged_prs", value: mergedPrs, unit: "PRs" },
    ],
    window: { from, to },
    filters: {
      days: String(days),
      ...(opts?.toolKey ? { tool: opts.toolKey } : {}),
      ...(opts?.teamNodeId ? { team: opts.teamNodeId } : {}),
    },
    notes: mergedPrs === 0 ? ["No merged PRs in window — connect GitHub"] : undefined,
  });

  const spendMetric = computeMetric({
    formula: "sum(ai_tool_daily.spend)",
    value: spend,
    inputs: [{ name: "rows", value: byTool.length, unit: "tools" }],
    window: { from, to },
    filters: { days: String(days) },
  });

  return {
    from,
    to,
    spend: spendMetric,
    tokens: Number(agg?.tokens ?? 0),
    sessions: Number(agg?.sessions ?? 0),
    activeContributors: Number(agg?.contributors ?? 0),
    costPerPr: costPerPrMetric,
    mergedPrs,
    byTool: byTool.map((r) => ({
      toolKey: r.toolKey,
      spend: Number(r.spend),
      tokens: Number(r.tokens),
    })),
    byContributor: byContributor.map((r) => ({
      contributorId: r.contributorId,
      email: r.email,
      name: r.name,
      team: r.team,
      spend: Number(r.spend),
      tokens: Number(r.tokens),
    })),
    byTeam: byTeam.map((r) => {
      const teamMergedPrs = mergedPrsByTeam.get(r.nodeId) ?? 0;
      return {
        nodeId: r.nodeId,
        team: r.team,
        spend: Number(r.spend),
        tokens: Number(r.tokens),
        costPerPr: teamMergedPrs > 0 ? Number(r.spend) / teamMergedPrs : 0,
      };
    }),
    daily: daily.map((r) => ({
      day: String(r.day),
      toolKey: r.toolKey,
      spend: Number(r.spend),
    })),
  };
}
