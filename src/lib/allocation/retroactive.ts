import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { applyAllocationRules } from "@/lib/allocation/apply";
import { getAllocationPct } from "@/lib/queries/allocation";

function tagsMatch(tags: Record<string, string>, match: Record<string, string>) {
  return Object.entries(match).every(
    ([k, v]) => String(tags[k] ?? "") === String(v)
  );
}

/**
 * Preview or apply a rule retroactively to historical unallocated cost/usage.
 * When apply=true, rewrites dimensions for matching rows and records an application.
 */
export async function previewOrApplyRule(
  orgId: string,
  rule: {
    id?: string;
    name: string;
    priority?: number;
    match: Record<string, string>;
    set: Record<string, string>;
  },
  opts: {
    apply: boolean;
    appliedBy?: string;
    /** When true (key registry), remap all matching rows — not only unallocated. */
    forceRemap?: boolean;
  }
) {
  const before = await getAllocationPct(orgId, 30);

  const candidates = await db
    .select()
    .from(s.costRecords)
    .where(
      opts.forceRemap
        ? eq(s.costRecords.orgId, orgId)
        : and(
            eq(s.costRecords.orgId, orgId),
            eq(s.costRecords.allocationStatus, "unallocated")
          )
    );

  const matching = candidates.filter((r) =>
    tagsMatch((r.tags ?? {}) as Record<string, string>, rule.match)
  );

  if (!opts.apply) {
    const spend = matching.reduce((a, r) => a + Number(r.effectiveCost), 0);
    // Estimate after % assuming all matching become allocated
    const afterAllocated = before.allocated + matching.length;
    const afterPct = before.total
      ? afterAllocated / before.total
      : before.allocatedPct;
    return {
      eventsWouldTouch: matching.length,
      spendWouldAllocate: spend,
      allocatedPctBefore: before.allocatedPct,
      allocatedPctAfter: afterPct,
      deltaPct: afterPct - before.allocatedPct,
    };
  }

  // Persist rule if new
  let ruleId = rule.id;
  if (!ruleId) {
    const [created] = await db
      .insert(s.allocationRules)
      .values({
        orgId,
        name: rule.name,
        priority: rule.priority ?? 50,
        match: rule.match,
        set: rule.set,
      })
      .returning();
    ruleId = created.id;
  }

  const types = await db
    .select()
    .from(s.dimensionTypes)
    .where(eq(s.dimensionTypes.orgId, orgId));
  const nodes = await db
    .select()
    .from(s.dimensionNodes)
    .where(eq(s.dimensionNodes.orgId, orgId));
  const typeByKey = new Map(types.map((t) => [t.key, t]));
  const nodeByTypeAndKey = new Map(
    nodes.map((n) => [`${n.dimensionTypeId}:${n.key}`, n])
  );

  const dims: { dimensionTypeId: string; dimensionNodeId: string }[] = [];
  for (const [typeKey, nodeKey] of Object.entries(rule.set)) {
    const type = typeByKey.get(typeKey);
    if (!type) continue;
    const node = nodeByTypeAndKey.get(`${type.id}:${nodeKey}`);
    if (!node) continue;
    dims.push({ dimensionTypeId: type.id, dimensionNodeId: node.id });
  }
  if (dims.length === 0) {
    throw new Error("Rule set did not resolve to any dimension nodes");
  }

  let touched = 0;
  for (const cost of matching) {
    await db
      .update(s.costRecords)
      .set({ allocationStatus: "allocated" })
      .where(eq(s.costRecords.id, cost.id));
    await db
      .delete(s.costRecordDimensions)
      .where(eq(s.costRecordDimensions.costRecordId, cost.id));
    if (dims.length) {
      await db.insert(s.costRecordDimensions).values(
        dims.map((d) => ({
          costRecordId: cost.id,
          dimensionTypeId: d.dimensionTypeId,
          dimensionNodeId: d.dimensionNodeId,
        }))
      );
    }
    touched++;
  }

  // Also re-allocate matching usage events
  const usage = await db
    .select()
    .from(s.usageEvents)
    .where(
      opts.forceRemap
        ? eq(s.usageEvents.orgId, orgId)
        : and(
            eq(s.usageEvents.orgId, orgId),
            eq(s.usageEvents.allocationStatus, "unallocated")
          )
    );
  for (const ev of usage) {
    if (!tagsMatch((ev.tags ?? {}) as Record<string, string>, rule.match)) continue;
    const alloc = await applyAllocationRules(
      orgId,
      (ev.tags ?? {}) as Record<string, string>
    );
    await db
      .update(s.usageEvents)
      .set({ allocationStatus: alloc.allocationStatus })
      .where(eq(s.usageEvents.id, ev.id));
    await db
      .delete(s.usageEventDimensions)
      .where(eq(s.usageEventDimensions.usageEventId, ev.id));
    if (alloc.dims.length) {
      await db.insert(s.usageEventDimensions).values(
        alloc.dims.map((d) => ({
          usageEventId: ev.id,
          dimensionTypeId: d.dimensionTypeId,
          dimensionNodeId: d.dimensionNodeId,
        }))
      );
    }
  }

  const after = await getAllocationPct(orgId, 30);
  await db.insert(s.allocationRuleApplications).values({
    orgId,
    ruleId,
    eventsTouched: touched,
    allocatedPctBefore: String(before.allocatedPct.toFixed(4)),
    allocatedPctAfter: String(after.allocatedPct.toFixed(4)),
    appliedBy: opts.appliedBy ?? "demo",
  });

  await db.insert(s.auditLogs).values({
    orgId,
    actorLabel: opts.appliedBy ?? "demo",
    action: "allocation_rule.apply_retroactive",
    entityType: "allocation_rules",
    entityId: ruleId,
    after: {
      eventsTouched: touched,
      allocatedPctBefore: before.allocatedPct,
      allocatedPctAfter: after.allocatedPct,
    },
  });

  return {
    ruleId,
    eventsTouched: touched,
    allocatedPctBefore: before.allocatedPct,
    allocatedPctAfter: after.allocatedPct,
    deltaPct: after.allocatedPct - before.allocatedPct,
  };
}

/** Assign selected cost record clusters to a dimension node (one-off, no rule). */
export async function assignClustersToNode(
  orgId: string,
  opts: {
    costRecordIds?: string[];
    match?: Record<string, string>;
    set: Record<string, string>;
  }
) {
  const types = await db
    .select()
    .from(s.dimensionTypes)
    .where(eq(s.dimensionTypes.orgId, orgId));
  const nodes = await db
    .select()
    .from(s.dimensionNodes)
    .where(eq(s.dimensionNodes.orgId, orgId));
  const typeByKey = new Map(types.map((t) => [t.key, t]));
  const nodeByTypeAndKey = new Map(
    nodes.map((n) => [`${n.dimensionTypeId}:${n.key}`, n])
  );

  const dims: { dimensionTypeId: string; dimensionNodeId: string }[] = [];
  for (const [typeKey, nodeKey] of Object.entries(opts.set)) {
    const type = typeByKey.get(typeKey);
    if (!type) continue;
    const node = nodeByTypeAndKey.get(`${type.id}:${nodeKey}`);
    if (!node) continue;
    dims.push({ dimensionTypeId: type.id, dimensionNodeId: node.id });
  }
  if (!dims.length) throw new Error("No valid dimension nodes in set");

  let candidates = await db
    .select()
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        eq(s.costRecords.allocationStatus, "unallocated")
      )
    );

  if (opts.costRecordIds?.length) {
    const idSet = new Set(opts.costRecordIds);
    candidates = candidates.filter((c) => idSet.has(c.id));
  } else if (opts.match) {
    candidates = candidates.filter((c) =>
      tagsMatch((c.tags ?? {}) as Record<string, string>, opts.match!)
    );
  }

  let touched = 0;
  for (const cost of candidates) {
    await db
      .update(s.costRecords)
      .set({ allocationStatus: "allocated" })
      .where(eq(s.costRecords.id, cost.id));
    await db
      .delete(s.costRecordDimensions)
      .where(eq(s.costRecordDimensions.costRecordId, cost.id));
    await db.insert(s.costRecordDimensions).values(
      dims.map((d) => ({
        costRecordId: cost.id,
        dimensionTypeId: d.dimensionTypeId,
        dimensionNodeId: d.dimensionNodeId,
      }))
    );
    touched++;
  }

  return { touched };
}

/** Resolve cost IDs for a cluster match pattern (for bulk assign). */
export async function costIdsForMatch(
  orgId: string,
  match: Record<string, string>
): Promise<string[]> {
  const rows = await db
    .select({ id: s.costRecords.id, tags: s.costRecords.tags })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        eq(s.costRecords.allocationStatus, "unallocated")
      )
    );
  return rows
    .filter((r) => tagsMatch((r.tags ?? {}) as Record<string, string>, match))
    .map((r) => r.id);
}
