import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { childPath, slugKey, type DimNode } from "@/lib/dimensions/tree";
import { mappedValue, type ColumnMap, type RawRow } from "@/lib/import/parse";

export const ORG_STRUCTURE_TARGETS = [
  { key: "node_name", label: "Node name", required: true },
  { key: "parent_name", label: "Parent name", required: false },
  { key: "dimension_type", label: "Dimension type", required: true },
  { key: "cost_center_code", label: "Cost center code", required: false },
  { key: "owner_email", label: "Owner email", required: false },
  { key: "node_key", label: "Node key (optional)", required: false },
] as const;

export type OrgStructureRow = {
  nodeName: string;
  parentName: string;
  dimensionType: string;
  costCenterCode: string;
  ownerEmail: string;
  nodeKey: string;
};

export type OrgPreviewNode = {
  key: string;
  displayName: string;
  dimensionType: string;
  parentKey: string | null;
  path: string;
  costCenterCode: string | null;
  ownerEmail: string | null;
  depth: number;
  status: "create" | "exists" | "error";
  error?: string;
};

export type OrgStructurePreview = {
  ok: boolean;
  errors: string[];
  nodes: OrgPreviewNode[];
  adapterContract: string;
};

/**
 * Adapter contract for future Okta / Workday sync (not implemented).
 * CSV columns map onto this shape via mapping templates.
 */
export const ORG_STRUCTURE_ADAPTER_CONTRACT = `
OrgStructureAdapter {
  listNodes(): Promise<{
    externalId: string;
    name: string;
    parentExternalId: string | null;
    dimensionType: string; // business_unit | department | team | cost_center
    costCenterCode?: string;
    ownerEmail?: string;
  }[]>
}
Map Okta groups / Workday Supervisory Orgs → dimensionType + parentExternalId,
then upsert into dimension_nodes with external_id = externalId.
`.trim();

export function mapOrgRows(rows: RawRow[], columnMap: ColumnMap): OrgStructureRow[] {
  return rows.map((row) => {
    const nodeName = mappedValue(row, columnMap.node_name) || "";
    const parentName = mappedValue(row, columnMap.parent_name) || "";
    const dimensionType = (
      mappedValue(row, columnMap.dimension_type) || ""
    ).toLowerCase();
    const costCenterCode = mappedValue(row, columnMap.cost_center_code) || "";
    const ownerEmail = mappedValue(row, columnMap.owner_email) || "";
    const nodeKey =
      mappedValue(row, columnMap.node_key) || slugKey(nodeName);
    return {
      nodeName: nodeName.trim(),
      parentName: parentName.trim(),
      dimensionType: dimensionType.trim(),
      costCenterCode: costCenterCode.trim(),
      ownerEmail: ownerEmail.trim(),
      nodeKey: slugKey(nodeKey) || slugKey(nodeName),
    };
  });
}

/** Validate cycles/orphans and produce a preview tree. */
export function previewOrgStructure(
  rows: OrgStructureRow[],
  existing: DimNode[],
  typeKeys: string[]
): OrgStructurePreview {
  const errors: string[] = [];
  const byName = new Map<string, OrgStructureRow>();
  const byKey = new Map<string, OrgStructureRow>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.nodeName) {
      errors.push(`Row ${i + 1}: node_name is required`);
      continue;
    }
    if (!r.dimensionType) {
      errors.push(`Row ${i + 1}: dimension_type is required`);
      continue;
    }
    if (!typeKeys.includes(r.dimensionType)) {
      errors.push(
        `Row ${i + 1}: unknown dimension_type "${r.dimensionType}" (have: ${typeKeys.join(", ")})`
      );
    }
    if (byName.has(r.nodeName.toLowerCase())) {
      errors.push(`Row ${i + 1}: duplicate node_name "${r.nodeName}"`);
    }
    byName.set(r.nodeName.toLowerCase(), r);
    byKey.set(r.nodeKey, r);
  }

  // Detect orphans (parent referenced but missing) and cycles
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const parentOf = (name: string): string | null => {
    const r = byName.get(name.toLowerCase());
    return r?.parentName ? r.parentName : null;
  };

  for (const r of byName.values()) {
    if (r.parentName && !byName.has(r.parentName.toLowerCase())) {
      // Parent may already exist in DB by display name
      const existsDb = existing.some(
        (n) => n.displayName.toLowerCase() === r.parentName.toLowerCase()
      );
      if (!existsDb) {
        errors.push(`Orphan: "${r.nodeName}" parent "${r.parentName}" not found`);
      }
    }
  }

  const walkCycle = (name: string): boolean => {
    const key = name.toLowerCase();
    if (visited.has(key)) return false;
    if (visiting.has(key)) return true;
    visiting.add(key);
    const p = parentOf(name);
    if (p && walkCycle(p)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };

  for (const r of byName.values()) {
    if (walkCycle(r.nodeName)) {
      errors.push(`Cycle detected involving "${r.nodeName}"`);
      break;
    }
  }

  // Build ordered preview with paths
  const existingByName = new Map(
    existing.map((n) => [n.displayName.toLowerCase(), n])
  );
  const previewByName = new Map<string, OrgPreviewNode>();

  const resolvePath = (r: OrgStructureRow, stack: string[]): OrgPreviewNode => {
    if (stack.includes(r.nodeName.toLowerCase())) {
      return {
        key: r.nodeKey,
        displayName: r.nodeName,
        dimensionType: r.dimensionType,
        parentKey: null,
        path: `/${r.nodeKey}`,
        costCenterCode: r.costCenterCode || null,
        ownerEmail: r.ownerEmail || null,
        depth: 0,
        status: "error",
        error: "cycle",
      };
    }
    if (previewByName.has(r.nodeName.toLowerCase())) {
      return previewByName.get(r.nodeName.toLowerCase())!;
    }

    let parentKey: string | null = null;
    let parentPath: string | null = null;
    let depth = 0;
    if (r.parentName) {
      const parentRow = byName.get(r.parentName.toLowerCase());
      if (parentRow) {
        const parentPrev = resolvePath(parentRow, [
          ...stack,
          r.nodeName.toLowerCase(),
        ]);
        parentKey = parentPrev.key;
        parentPath = parentPrev.path;
        depth = parentPrev.depth + 1;
      } else {
        const dbParent = existingByName.get(r.parentName.toLowerCase());
        if (dbParent) {
          parentKey = dbParent.key;
          parentPath = dbParent.path;
          depth = dbParent.path.split("/").filter(Boolean).length;
        }
      }
    }

    const existingNode = existing.find(
      (n) => n.key === r.nodeKey || n.displayName.toLowerCase() === r.nodeName.toLowerCase()
    );
    const node: OrgPreviewNode = {
      key: r.nodeKey,
      displayName: r.nodeName,
      dimensionType: r.dimensionType,
      parentKey,
      path: childPath(parentPath, r.nodeKey),
      costCenterCode: r.costCenterCode || null,
      ownerEmail: r.ownerEmail || null,
      depth,
      status: existingNode ? "exists" : "create",
    };
    previewByName.set(r.nodeName.toLowerCase(), node);
    return node;
  };

  const nodes = [...byName.values()].map((r) => resolvePath(r, []));
  nodes.sort((a, b) => a.path.localeCompare(b.path));

  return {
    ok: errors.length === 0,
    errors,
    nodes,
    adapterContract: ORG_STRUCTURE_ADAPTER_CONTRACT,
  };
}

export async function executeOrgStructureImport(
  orgId: string,
  preview: OrgStructurePreview
): Promise<{ created: number; updated: number }> {
  if (!preview.ok) throw new Error(preview.errors.join("; "));

  const types = await db
    .select()
    .from(s.dimensionTypes)
    .where(eq(s.dimensionTypes.orgId, orgId));
  const typeByKey = new Map(types.map((t) => [t.key, t]));

  let created = 0;
  let updated = 0;

  // Insert parents before children (sorted by path depth)
  const ordered = [...preview.nodes].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  const idByKey = new Map<string, string>();

  const existing = await db
    .select()
    .from(s.dimensionNodes)
    .where(eq(s.dimensionNodes.orgId, orgId));
  for (const n of existing) idByKey.set(n.key, n.id);

  for (const node of ordered) {
    const type = typeByKey.get(node.dimensionType);
    if (!type) throw new Error(`Missing dimension type ${node.dimensionType}`);

    const parentId = node.parentKey ? idByKey.get(node.parentKey) ?? null : null;
    const existingRow = existing.find((n) => n.key === node.key);

    if (existingRow) {
      await db
        .update(s.dimensionNodes)
        .set({
          displayName: node.displayName,
          parentId,
          path: node.path,
          costCenterCode: node.costCenterCode,
          ownerEmail: node.ownerEmail,
          active: true,
        })
        .where(eq(s.dimensionNodes.id, existingRow.id));
      idByKey.set(node.key, existingRow.id);
      updated++;
    } else {
      const [row] = await db
        .insert(s.dimensionNodes)
        .values({
          orgId,
          dimensionTypeId: type.id,
          key: node.key,
          displayName: node.displayName,
          parentId,
          path: node.path,
          costCenterCode: node.costCenterCode,
          ownerEmail: node.ownerEmail,
        })
        .returning();
      idByKey.set(node.key, row.id);
      created++;
    }
  }

  await db.insert(s.auditLogs).values({
    orgId,
    actorLabel: "demo",
    action: "org_structure.import",
    entityType: "dimension_nodes",
    entityId: orgId,
    after: { created, updated, count: ordered.length },
  });

  return { created, updated };
}

export function defaultOrgStructureMap(): ColumnMap {
  return {
    node_name: "node_name",
    parent_name: "parent_name",
    dimension_type: "dimension_type",
    cost_center_code: "cost_center_code",
    owner_email: "owner_email",
    node_key: "node_key",
  };
}

export async function ensureOrgStructureTemplate() {
  const [existing] = await db
    .select()
    .from(s.mappingTemplates)
    .where(
      and(
        eq(s.mappingTemplates.isSystem, true),
        eq(s.mappingTemplates.sourceFormat, "org_structure")
      )
    )
    .limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(s.mappingTemplates)
    .values({
      orgId: null,
      providerId: null,
      name: "Org structure (BU / dept / team)",
      sourceFormat: "org_structure",
      isSystem: true,
      columnMap: defaultOrgStructureMap(),
      sampleHeaders: [
        "node_name",
        "parent_name",
        "dimension_type",
        "cost_center_code",
        "owner_email",
        "node_key",
      ],
    })
    .returning();
  return row;
}
