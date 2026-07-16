import { db } from "@/db";
import * as s from "@/db/schema";
import type { BudgetPolicyAction, BudgetPolicyRule } from "@/db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

function monthBounds(d = new Date()) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dimFilterSql(nodeId: string | null, includeDescendants: boolean) {
  if (!nodeId) return sql`true`;
  if (!includeDescendants) {
    return sql`exists (
      select 1 from cost_record_dimensions crd
      where crd.cost_record_id = ${s.costRecords.id}
        and crd.dimension_node_id = ${nodeId}
    )`;
  }
  return sql`exists (
    select 1
    from cost_record_dimensions crd
    join dimension_nodes n on n.id = crd.dimension_node_id
    join dimension_nodes sel on sel.id = ${nodeId}
    where crd.cost_record_id = ${s.costRecords.id}
      and (n.id = sel.id or n.path = sel.path or n.path like sel.path || '/%')
  )`;
}

export type BudgetStatus = {
  budgetId: string;
  name: string;
  status: "ok" | "warn" | "projected-breach" | "exceeded";
  policyAction: BudgetPolicyAction | null;
  recommendedModel: string | null;
  amount: number;
  spent: number;
  remaining: number;
  projectedP10: number;
  projectedP50: number;
  projectedP90: number;
  breachDate: string | null;
  periodEnd: string;
  usedPct: number;
  burnDown: { day: string; actual: number; proRata: number; p10: number; p50: number; p90: number }[];
};

async function scopedSpend(
  orgId: string,
  opts: {
    nodeId: string | null;
    includeDescendants: boolean;
    featureKey: string | null;
    from: Date;
    to?: Date;
  }
): Promise<number> {
  const featureFilter = opts.featureKey
    ? sql`${s.costRecords.tags}->>'feature' = ${opts.featureKey}`
    : sql`true`;
  const toFilter = opts.to
    ? lt(s.costRecords.chargePeriodStart, opts.to)
    : sql`true`;

  const [row] = await db
    .select({
      spend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, opts.from),
        toFilter,
        dimFilterSql(opts.nodeId, opts.includeDescendants),
        featureFilter
      )
    );
  return Number(row?.spend ?? 0);
}

async function dailyScopedSpend(
  orgId: string,
  opts: {
    nodeId: string | null;
    includeDescendants: boolean;
    featureKey: string | null;
    from: Date;
  }
): Promise<{ day: string; spend: number }[]> {
  const featureFilter = opts.featureKey
    ? sql`${s.costRecords.tags}->>'feature' = ${opts.featureKey}`
    : sql`true`;

  const rows = await db
    .select({
      day: sql<string>`(${s.costRecords.chargePeriodStart})::date`,
      spend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}),0)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, opts.from),
        dimFilterSql(opts.nodeId, opts.includeDescendants),
        featureFilter
      )
    )
    .groupBy(sql`(${s.costRecords.chargePeriodStart})::date`)
    .orderBy(sql`(${s.costRecords.chargePeriodStart})::date`);

  return rows.map((r) => ({ day: String(r.day), spend: Number(r.spend) }));
}

function defaultPolicy(thresholds: number[]): BudgetPolicyRule[] {
  return (thresholds.length ? thresholds : [0.8, 1.0]).map((pct) => {
    if (pct >= 1) {
      return {
        pct,
        action: "advisory_block" as const,
        recommendedModel: "claude-haiku-3.5",
      };
    }
    if (pct >= 0.8) {
      return {
        pct,
        action: "advisory_downgrade" as const,
        recommendedModel: "claude-haiku-3.5",
      };
    }
    return { pct, action: "notify" as const };
  });
}

function pickPolicy(
  usedPct: number,
  projectedPct: number,
  policy: BudgetPolicyRule[]
): { action: BudgetPolicyAction | null; recommendedModel: string | null } {
  const effective = Math.max(usedPct, projectedPct);
  const sorted = [...policy].sort((a, b) => b.pct - a.pct);
  for (const rule of sorted) {
    if (effective >= rule.pct) {
      return {
        action: rule.action,
        recommendedModel: rule.recommendedModel ?? null,
      };
    }
  }
  return { action: null, recommendedModel: null };
}

export async function computeBudgetStatus(
  budget: typeof s.budgets.$inferSelect,
  policy?: BudgetPolicyRule[]
): Promise<BudgetStatus> {
  const { start, end } = monthBounds();
  const amount = Number(budget.amount);
  const nodeId = budget.dimensionNodeId;
  const featureKey = budget.featureKey;
  const includeDescendants = budget.includeDescendants;

  const spent = await scopedSpend(budget.orgId, {
    nodeId,
    includeDescendants,
    featureKey,
    from: start,
    to: end,
  });

  const daily = await dailyScopedSpend(budget.orgId, {
    nodeId,
    includeDescendants,
    featureKey,
    from: daysAgo(30),
  });

  const recent = daily.slice(-7);
  const dailyRate =
    recent.length > 0
      ? recent.reduce((a, r) => a + r.spend, 0) / recent.length
      : spent / Math.max(1, new Date().getUTCDate());

  // Residual CV from last 30d for P10/P90 bands (forecast-driven, not linear-only)
  const mean =
    daily.length > 0
      ? daily.reduce((a, r) => a + r.spend, 0) / daily.length
      : dailyRate;
  const variance =
    daily.length > 1
      ? daily.reduce((a, r) => a + (r.spend - mean) ** 2, 0) / (daily.length - 1)
      : (mean * 0.15) ** 2;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0.15;
  const band = Math.min(0.45, Math.max(0.08, cv * 1.28));

  const today = new Date();
  const dayOfMonth = today.getUTCDate();
  const daysInMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const remainingDays = Math.max(0, daysInMonth - dayOfMonth);

  const projectedP50 = spent + dailyRate * remainingDays;
  const projectedP10 = spent + dailyRate * (1 - band) * remainingDays;
  const projectedP90 = spent + dailyRate * (1 + band) * remainingDays;

  let breachDate: string | null = null;
  if (dailyRate > 0 && spent < amount) {
    const daysUntil = Math.ceil((amount - spent) / dailyRate);
    if (daysUntil <= remainingDays) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() + daysUntil);
      breachDate = d.toISOString().slice(0, 10);
    }
  } else if (spent >= amount) {
    breachDate = today.toISOString().slice(0, 10);
  }

  const usedPct = amount > 0 ? spent / amount : 0;
  const projectedPct = amount > 0 ? projectedP50 / amount : 0;

  let status: BudgetStatus["status"] = "ok";
  if (usedPct >= 1) status = "exceeded";
  else if (breachDate && projectedPct >= 1) status = "projected-breach";
  else if (usedPct >= 0.8 || projectedPct >= 0.8) status = "warn";

  const rules = policy?.length ? policy : defaultPolicy(budget.thresholds ?? []);
  const { action, recommendedModel } = pickPolicy(usedPct, projectedPct, rules);

  // Burn-down series for current month
  const mtdDaily = await dailyScopedSpend(budget.orgId, {
    nodeId,
    includeDescendants,
    featureKey,
    from: start,
  });
  const byDay = new Map(mtdDaily.map((r) => [r.day, r.spend]));
  const burnDown: BudgetStatus["burnDown"] = [];
  let cumActual = 0;
  let cumP50 = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), d));
    const key = day.toISOString().slice(0, 10);
    const proRata = (amount * d) / daysInMonth;
    if (d <= dayOfMonth) {
      cumActual += byDay.get(key) ?? 0;
      cumP50 = cumActual;
      burnDown.push({
        day: key,
        actual: cumActual,
        proRata,
        p10: cumActual,
        p50: cumActual,
        p90: cumActual,
      });
    } else {
      const ahead = d - dayOfMonth;
      const p50 = spent + dailyRate * ahead;
      burnDown.push({
        day: key,
        actual: cumActual,
        proRata,
        p10: spent + dailyRate * (1 - band) * ahead,
        p50,
        p90: spent + dailyRate * (1 + band) * ahead,
      });
      void cumP50;
    }
  }

  return {
    budgetId: budget.id,
    name: budget.name,
    status,
    policyAction: action,
    recommendedModel,
    amount,
    spent,
    remaining: Math.max(0, amount - spent),
    projectedP10,
    projectedP50,
    projectedP90,
    breachDate,
    periodEnd: end.toISOString().slice(0, 10),
    usedPct,
    burnDown,
  };
}

export async function refreshBudgetSnapshots(orgId: string): Promise<BudgetStatus[]> {
  const budgets = await db
    .select()
    .from(s.budgets)
    .where(eq(s.budgets.orgId, orgId));

  const results: BudgetStatus[] = [];

  for (const budget of budgets) {
    let policy: BudgetPolicyRule[] | undefined;
    if (budget.currentVersionId) {
      const [ver] = await db
        .select()
        .from(s.budgetVersions)
        .where(eq(s.budgetVersions.id, budget.currentVersionId))
        .limit(1);
      policy = ver?.policy;
    }

    const status = await computeBudgetStatus(budget, policy);
    results.push(status);

    // Upsert snapshot (delete + insert for simplicity)
    await db
      .delete(s.budgetStatusSnapshots)
      .where(eq(s.budgetStatusSnapshots.budgetId, budget.id));

    const snapStatus =
      status.status === "projected-breach"
        ? "warn"
        : status.status === "exceeded"
          ? "exceeded"
          : status.status === "warn"
            ? "warn"
            : "ok";

    await db.insert(s.budgetStatusSnapshots).values({
      budgetId: budget.id,
      orgId,
      dimensionNodeId: budget.dimensionNodeId,
      featureKey: budget.featureKey,
      status: snapStatus,
      policyAction: status.policyAction,
      remaining: String(status.remaining.toFixed(2)),
      spent: String(status.spent.toFixed(2)),
      projectedP50: String(status.projectedP50.toFixed(2)),
      breachDate: status.breachDate,
      periodEnd: status.periodEnd,
      recommendedModel: status.recommendedModel,
      refreshedAt: new Date(),
    });

    // Fire threshold alerts (dedupe by threshold for current day)
    if (status.policyAction && (status.status === "warn" || status.status === "projected-breach" || status.status === "exceeded")) {
      const thresh = status.status === "exceeded" ? 1 : 0.8;
      const today = new Date().toISOString().slice(0, 10);
      const existing = await db
        .select()
        .from(s.budgetAlerts)
        .where(eq(s.budgetAlerts.budgetId, budget.id))
        .limit(20);
      const already = existing.some(
        (a) =>
          Number(a.thresholdPct) === thresh &&
          a.firedAt.toISOString().slice(0, 10) === today
      );
      if (!already) {
        await db.insert(s.budgetAlerts).values({
          budgetId: budget.id,
          thresholdPct: String(thresh),
          projectedBreachDate: status.breachDate,
          message: `${budget.name}: ${status.status} (${(status.usedPct * 100).toFixed(0)}% used, P50 EOP $${status.projectedP50.toFixed(0)})`,
          policyAction: status.policyAction,
        });
        await db.insert(s.notifications).values({
          orgId,
          kind: "budget_threshold",
          title: `${budget.name} ${status.status}`,
          body: `Policy: ${status.policyAction}. Remaining $${status.remaining.toFixed(0)}.`,
          href: "/budgets",
        });

        // Fire org webhooks (best-effort)
        const hooks = await db
          .select()
          .from(s.orgWebhooks)
          .where(eq(s.orgWebhooks.orgId, orgId));
        for (const hook of hooks) {
          try {
            await fetch(hook.url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                type: "budget.status",
                budgetId: budget.id,
                status: status.status,
                policyAction: status.policyAction,
                remaining: status.remaining,
                periodEnd: status.periodEnd,
                recommendedModel: status.recommendedModel,
              }),
            });
          } catch {
            /* stub: ignore delivery failures */
          }
        }
      }
    }
  }

  return results;
}

export async function getStatusFromSnapshots(
  orgId: string,
  opts?: { dimensionNodeId?: string; featureKey?: string; team?: string }
) {
  // Ensure fresh enough (< 15 min) else refresh
  const [latest] = await db
    .select()
    .from(s.budgetStatusSnapshots)
    .where(eq(s.budgetStatusSnapshots.orgId, orgId))
    .limit(1);

  const stale =
    !latest ||
    Date.now() - new Date(latest.refreshedAt).getTime() > 15 * 60_000;
  if (stale) {
    await refreshBudgetSnapshots(orgId);
  }

  let rows = await db
    .select()
    .from(s.budgetStatusSnapshots)
    .where(eq(s.budgetStatusSnapshots.orgId, orgId));

  if (opts?.dimensionNodeId) {
    rows = rows.filter((r) => r.dimensionNodeId === opts.dimensionNodeId);
  }
  if (opts?.featureKey) {
    rows = rows.filter((r) => r.featureKey === opts.featureKey);
  }

  // If filtering by team key, resolve node
  if (opts?.team && !opts.dimensionNodeId) {
    const [node] = await db
      .select()
      .from(s.dimensionNodes)
      .where(
        and(eq(s.dimensionNodes.orgId, orgId), eq(s.dimensionNodes.key, opts.team))
      )
      .limit(1);
    if (node) {
      rows = rows.filter(
        (r) => r.dimensionNodeId === node.id || r.dimensionNodeId == null
      );
    }
  }

  return rows.map((r) => ({
    budgetId: r.budgetId,
    status: r.status as "ok" | "warn" | "exceeded",
    policy_action: r.policyAction,
    remaining: Number(r.remaining),
    spent: Number(r.spent),
    projected_p50: Number(r.projectedP50),
    period_end: r.periodEnd,
    recommended_model: r.recommendedModel,
    breach_date: r.breachDate,
  }));
}

export async function createBudgetVersion(
  budgetId: string,
  patch: {
    amount?: number;
    changeNote: string;
    author?: string;
    policy?: BudgetPolicyRule[];
    reallocationGroupId?: string;
  }
) {
  const [budget] = await db
    .select()
    .from(s.budgets)
    .where(eq(s.budgets.id, budgetId))
    .limit(1);
  if (!budget) throw new Error("Budget not found");

  const versions = await db
    .select()
    .from(s.budgetVersions)
    .where(eq(s.budgetVersions.budgetId, budgetId));
  const nextVersion =
    versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;

  // Close previous version
  if (budget.currentVersionId) {
    await db
      .update(s.budgetVersions)
      .set({ effectiveTo: new Date() })
      .where(eq(s.budgetVersions.id, budget.currentVersionId));
  }

  const amount = patch.amount ?? Number(budget.amount);
  const [ver] = await db
    .insert(s.budgetVersions)
    .values({
      budgetId,
      version: nextVersion,
      amount: String(amount),
      currency: budget.currency,
      period: budget.period,
      scopeType: budget.scopeType,
      dimensionTypeId: budget.dimensionTypeId,
      dimensionNodeId: budget.dimensionNodeId,
      featureKey: budget.featureKey,
      includeDescendants: budget.includeDescendants,
      thresholds: budget.thresholds,
      policy: patch.policy ?? defaultPolicy(budget.thresholds ?? []),
      effectiveFrom: new Date(),
      author: patch.author ?? "demo",
      changeNote: patch.changeNote,
      reallocationGroupId: patch.reallocationGroupId,
    })
    .returning();

  await db
    .update(s.budgets)
    .set({ amount: String(amount), currentVersionId: ver.id })
    .where(eq(s.budgets.id, budgetId));

  await db.insert(s.auditLogs).values({
    orgId: budget.orgId,
    actorLabel: patch.author ?? "demo",
    action: "budget.version",
    entityType: "budgets",
    entityId: budgetId,
    after: { version: nextVersion, amount, changeNote: patch.changeNote },
  });

  return ver;
}

/** Move $amount from budget A to B; parent total invariant when they share parent. */
export async function reallocateBudgets(opts: {
  fromBudgetId: string;
  toBudgetId: string;
  amount: number;
  changeNote: string;
  author?: string;
}) {
  if (opts.amount <= 0) throw new Error("amount must be positive");
  const [from, to] = await Promise.all([
    db.select().from(s.budgets).where(eq(s.budgets.id, opts.fromBudgetId)).limit(1),
    db.select().from(s.budgets).where(eq(s.budgets.id, opts.toBudgetId)).limit(1),
  ]);
  const a = from[0];
  const b = to[0];
  if (!a || !b) throw new Error("Budget not found");
  if (a.orgId !== b.orgId) throw new Error("Budgets must share an org");
  if (Number(a.amount) < opts.amount) throw new Error("Insufficient source budget");

  if (a.parentBudgetId && b.parentBudgetId && a.parentBudgetId !== b.parentBudgetId) {
    throw new Error("Reallocation requires a shared parent budget");
  }

  const groupId = randomUUID();
  const note = opts.changeNote || `Reallocate $${opts.amount}`;
  await createBudgetVersion(a.id, {
    amount: Number(a.amount) - opts.amount,
    changeNote: note,
    author: opts.author,
    reallocationGroupId: groupId,
  });
  await createBudgetVersion(b.id, {
    amount: Number(b.amount) + opts.amount,
    changeNote: note,
    author: opts.author,
    reallocationGroupId: groupId,
  });

  return { reallocationGroupId: groupId };
}

/** Flag child budgets that exceed parent amount (warning only). */
export async function hierarchyWarnings(orgId: string) {
  const budgets = await db
    .select()
    .from(s.budgets)
    .where(eq(s.budgets.orgId, orgId));
  const byId = new Map(budgets.map((b) => [b.id, b]));
  const warnings: { childId: string; childName: string; parentId: string; parentName: string; childAmount: number; parentAmount: number }[] = [];
  for (const b of budgets) {
    if (!b.parentBudgetId) continue;
    const parent = byId.get(b.parentBudgetId);
    if (!parent) continue;
    if (Number(b.amount) > Number(parent.amount)) {
      warnings.push({
        childId: b.id,
        childName: b.name,
        parentId: parent.id,
        parentName: parent.name,
        childAmount: Number(b.amount),
        parentAmount: Number(parent.amount),
      });
    }
  }
  return warnings;
}
