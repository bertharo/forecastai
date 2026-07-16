import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export type AllocatedDimensions = {
  allocationStatus: "allocated" | "unallocated";
  dims: { dimensionTypeId: string; dimensionNodeId: string }[];
};

/**
 * Match tags against org allocation_rules (priority ascending).
 * Rule `set` maps dimension type key → dimension node key.
 */
export async function applyAllocationRules(
  orgId: string,
  tags: Record<string, string>
): Promise<AllocatedDimensions> {
  const [rules, types, nodes] = await Promise.all([
    db
      .select()
      .from(s.allocationRules)
      .where(eq(s.allocationRules.orgId, orgId))
      .orderBy(asc(s.allocationRules.priority)),
    db.select().from(s.dimensionTypes).where(eq(s.dimensionTypes.orgId, orgId)),
    db.select().from(s.dimensionNodes).where(eq(s.dimensionNodes.orgId, orgId)),
  ]);

  const typeByKey = new Map(types.map((t) => [t.key, t]));
  const nodeByTypeAndKey = new Map(
    nodes.map((n) => [`${n.dimensionTypeId}:${n.key}`, n])
  );

  for (const rule of rules) {
    const match = rule.match ?? {};
    const ok = Object.entries(match).every(
      ([k, v]) => String(tags[k] ?? "") === String(v)
    );
    if (!ok) continue;

    const dims: AllocatedDimensions["dims"] = [];
    for (const [typeKey, nodeKey] of Object.entries(rule.set ?? {})) {
      const type = typeByKey.get(typeKey);
      if (!type) continue;
      const node = nodeByTypeAndKey.get(`${type.id}:${nodeKey}`);
      if (!node) continue;
      dims.push({ dimensionTypeId: type.id, dimensionNodeId: node.id });
    }
    if (dims.length > 0) {
      return { allocationStatus: "allocated", dims };
    }
  }

  // Fallback: match tag keys that equal dimension type keys (e.g. tags.team → team node)
  const dims: AllocatedDimensions["dims"] = [];
  for (const type of types) {
    const nodeKey = tags[type.key];
    if (!nodeKey) continue;
    const node = nodeByTypeAndKey.get(`${type.id}:${nodeKey}`);
    if (node) {
      dims.push({ dimensionTypeId: type.id, dimensionNodeId: node.id });
    }
  }
  if (dims.length > 0) {
    return { allocationStatus: "allocated", dims };
  }

  return { allocationStatus: "unallocated", dims: [] };
}
