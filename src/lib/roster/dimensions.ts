/**
 * Generic people-CSV dimensions — profile, classify, configure, migrate.
 * No assumed column names, ordering, count, or hierarchy.
 */
import { db } from "@/db";
import * as s from "@/db/schema";
import type {
  PeopleDimensionColumnConfig,
  PeopleDimensionConfig,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { normalizeHeaderKey } from "@/lib/import/telemetry";

export type DimensionSuggestion = "identifier" | "constant" | "dimension";

export type AttributeProfile = {
  key: string;
  sourceColumn: string;
  distinctCount: number;
  sampleValues: string[];
  suggestion: DimensionSuggestion;
};

/** Columns that identify a person or employment metadata — never grouping dims. */
const IDENTITY_KEYS = new Set([
  "email",
  "work_email",
  "user_email",
  "e_mail",
  "mail",
  "display_name",
  "name",
  "full_name",
  "employee_name",
  "preferred_name",
  "employment_status",
  "status",
  "employee_status",
  "hr_status",
  "worker_status",
  "started_on",
  "start_date",
  "hire_date",
  "start",
  "employment_start",
  "ended_on",
  "end_date",
  "termination_date",
  "term_date",
  "employment_end",
  "team_key",
  "team_id",
  "github_login",
  "github",
  "github_id",
]);

export function isIdentityColumnKey(key: string): boolean {
  return IDENTITY_KEYS.has(normalizeHeaderKey(key));
}

export function classifyAttribute(
  distinctCount: number,
  rowCount: number
): DimensionSuggestion {
  if (rowCount <= 0) return "constant";
  if (distinctCount <= 1) return "constant";
  if (distinctCount >= rowCount) return "identifier";
  return "dimension";
}

export function isGroupingEligible(suggestion: DimensionSuggestion): boolean {
  return suggestion === "dimension";
}

/**
 * Profile attribute columns from normalized row maps.
 * `sourceColumns` maps normalized key → original header label.
 */
export function profileAttributeColumns(
  rows: Record<string, string>[],
  sourceColumns: Record<string, string>,
  opts?: { excludeKeys?: Set<string> }
): AttributeProfile[] {
  const exclude = opts?.excludeKeys ?? new Set<string>();
  const keys = Object.keys(sourceColumns).filter(
    (k) => !isIdentityColumnKey(k) && !exclude.has(k)
  );
  const rowCount = rows.length;
  const profiles: AttributeProfile[] = [];

  for (const key of keys) {
    const values = rows
      .map((r) => (r[key] ?? "").trim())
      .filter((v) => v.length > 0);
    const distinct = new Set(values);
    const distinctCount = distinct.size;
    const sampleValues = [...distinct].slice(0, 3);
    profiles.push({
      key,
      sourceColumn: sourceColumns[key] ?? key,
      distinctCount,
      sampleValues,
      suggestion: classifyAttribute(distinctCount, rowCount),
    });
  }

  return profiles.sort((a, b) => a.sourceColumn.localeCompare(b.sourceColumn));
}

export function emptyPeopleDimensionConfig(): PeopleDimensionConfig {
  return { columns: [], profiledAt: null, rowCount: 0 };
}

/** Merge fresh profiles into existing config, preserving user enable/rename/role. */
export function mergeProfilesIntoConfig(
  existing: PeopleDimensionConfig | null | undefined,
  profiles: AttributeProfile[],
  rowCount: number
): PeopleDimensionConfig {
  const prevByKey = new Map((existing?.columns ?? []).map((c) => [c.key, c]));
  const columns: PeopleDimensionColumnConfig[] = profiles.map((p) => {
    const prev = prevByKey.get(p.key);
    const suggestion = p.suggestion;
    // Identifiers cannot remain enabled as grouping dims
    const enabled =
      prev && isGroupingEligible(suggestion) ? prev.enabled : false;
    let role = prev?.role ?? null;
    if (!enabled || !isGroupingEligible(suggestion)) role = null;
    return {
      key: p.key,
      sourceColumn: p.sourceColumn,
      displayName: prev?.displayName ?? p.sourceColumn,
      enabled,
      role,
      suggestion,
      distinctCount: p.distinctCount,
      sampleValues: p.sampleValues,
    };
  });

  return normalizeRoles({
    columns,
    profiledAt: new Date().toISOString(),
    rowCount,
  });
}

/** Ensure at most one primary and one secondary among enabled eligible columns. */
export function normalizeRoles(config: PeopleDimensionConfig): PeopleDimensionConfig {
  const columns = config.columns.map((c) => ({ ...c }));
  let primary: PeopleDimensionColumnConfig | null = null;
  let secondary: PeopleDimensionColumnConfig | null = null;

  for (const c of columns) {
    if (!c.enabled || !isGroupingEligible(c.suggestion)) {
      c.enabled = c.enabled && isGroupingEligible(c.suggestion);
      c.role = null;
      continue;
    }
    if (c.role === "primary" && !primary) {
      primary = c;
    } else if (c.role === "secondary" && !secondary) {
      secondary = c;
    } else if (c.role === "primary" || c.role === "secondary") {
      c.role = null;
    }
  }

  return { ...config, columns };
}

/**
 * Legacy migration: auto-enable columns that backed the old dept / cost-center cards.
 * PRIMARY = fewest distinct values above 1 among enabled.
 */
export function autoEnableLegacyVisibleColumns(
  config: PeopleDimensionConfig
): PeopleDimensionConfig {
  if (config.columns.some((c) => c.enabled)) return config;

  const legacyKeys = ["department", "cost_center"];
  const chainKeys = config.columns
    .filter((c) => c.key.startsWith("cost_center_chain_level_"))
    .map((c) => c.key)
    .sort();

  const prefer = legacyKeys.filter((k) =>
    config.columns.some(
      (c) => c.key === k && isGroupingEligible(c.suggestion) && c.distinctCount > 1
    )
  );

  let toEnable: string[] = prefer;
  if (toEnable.length === 0 && chainKeys.length > 0) {
    // Fall back: mid chain (level 04 if present) + deepest filled level key present
    const level04 = chainKeys.find((k) => k.endsWith("_04") || k.endsWith("_4"));
    const deepest = chainKeys[chainKeys.length - 1];
    toEnable = [level04, deepest].filter(
      (k): k is string => Boolean(k) && config.columns.some((c) => c.key === k)
    );
    toEnable = [...new Set(toEnable)];
  }

  if (toEnable.length === 0) {
    // Any usable dimension columns — enable up to two with lowest distinct > 1
    toEnable = config.columns
      .filter((c) => isGroupingEligible(c.suggestion) && c.distinctCount > 1)
      .sort((a, b) => a.distinctCount - b.distinctCount)
      .slice(0, 2)
      .map((c) => c.key);
  }

  const columns: PeopleDimensionColumnConfig[] = config.columns.map((c) => {
    if (!toEnable.includes(c.key) || !isGroupingEligible(c.suggestion)) {
      return { ...c, enabled: false, role: null };
    }
    return {
      ...c,
      enabled: true,
      displayName: c.displayName || c.sourceColumn,
      role: null,
    };
  });

  const enabled = columns
    .filter((c) => c.enabled)
    .sort((a, b) => a.distinctCount - b.distinctCount);
  if (enabled[0]) {
    const p = columns.find((c) => c.key === enabled[0].key);
    if (p) p.role = "primary";
  }
  if (enabled[1]) {
    const sCol = columns.find((c) => c.key === enabled[1].key);
    if (sCol) sCol.role = "secondary";
  }

  return normalizeRoles({ ...config, columns });
}

/** Build attributes map from a normalized people row + known source keys. */
export function attributesFromRow(
  row: Record<string, string>,
  attributeKeys: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of attributeKeys) {
    const v = (row[key] ?? "").trim();
    if (v) out[key] = v;
  }
  return out;
}

/**
 * Collapse legacy department / costCenter / costCenterChain into attributes.
 */
export function attributesFromLegacyFields(input: {
  department?: string | null;
  costCenter?: string | null;
  costCenterChain?: Record<string, string> | null;
  attributes?: Record<string, string> | null;
}): Record<string, string> {
  const out: Record<string, string> = { ...(input.attributes ?? {}) };
  const chain = input.costCenterChain ?? {};
  for (const [level, value] of Object.entries(chain)) {
    const v = (value ?? "").trim();
    if (!v) continue;
    const padded = level.padStart(2, "0");
    const key = `cost_center_chain_level_${padded}`;
    if (!out[key]) out[key] = v;
  }
  if (input.department?.trim() && !out.department) {
    out.department = input.department.trim();
  }
  if (input.costCenter?.trim() && !out.cost_center) {
    out.cost_center = input.costCenter.trim();
  }
  return out;
}

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows: T[] }).rows ?? []) as T[];
  }
  return [];
}

/** Profile attributes already stored on contributors for an org. */
export async function profileOrgAttributes(
  orgId: string
): Promise<{ profiles: AttributeProfile[]; rowCount: number }> {
  const people = await db
    .select({
      attributes: s.contributors.attributes,
      department: s.contributors.department,
      costCenter: s.contributors.costCenter,
      costCenterChain: s.contributors.costCenterChain,
    })
    .from(s.contributors)
    .where(eq(s.contributors.orgId, orgId));

  const rowCount = people.length;
  const keyValues = new Map<string, Set<string>>();

  for (const p of people) {
    const attrs = attributesFromLegacyFields({
      department: p.department,
      costCenter: p.costCenter,
      costCenterChain: p.costCenterChain,
      attributes: p.attributes,
    });
    for (const [k, v] of Object.entries(attrs)) {
      if (!v?.trim() || isIdentityColumnKey(k)) continue;
      if (!keyValues.has(k)) keyValues.set(k, new Set());
      keyValues.get(k)!.add(v.trim());
    }
  }

  const profiles: AttributeProfile[] = [...keyValues.entries()]
    .map(([key, set]) => ({
      key,
      sourceColumn: key,
      distinctCount: set.size,
      sampleValues: [...set].slice(0, 3),
      suggestion: classifyAttribute(set.size, rowCount),
    }))
    .sort((a, b) => a.sourceColumn.localeCompare(b.sourceColumn));

  return { profiles, rowCount };
}

/**
 * Ensure people have attributes filled from legacy fields, and org has a
 * dimension config (auto-migrating legacy chain / dept / CC workspaces).
 */
export async function ensurePeopleDimensionConfig(
  orgId: string
): Promise<PeopleDimensionConfig> {
  const [org] = await db
    .select({
      config: s.organizations.peopleDimensionConfig,
    })
    .from(s.organizations)
    .where(eq(s.organizations.id, orgId))
    .limit(1);

  // Backfill attributes from legacy columns where attributes are empty
  await db.execute(sql`
    update contributors
    set attributes = attributes || jsonb_strip_nulls(jsonb_build_object(
      'department', nullif(trim(coalesce(department, '')), ''),
      'cost_center', nullif(trim(coalesce(cost_center, '')), '')
    ))
    where org_id = ${orgId}::uuid
      and (
        (department is not null and department <> '' and attributes->>'department' is null)
        or (cost_center is not null and cost_center <> '' and attributes->>'cost_center' is null)
      )
  `);

  // Merge cost_center_chain levels into attributes
  await db.execute(sql`
    update contributors c
    set attributes = c.attributes || sub.chain_attrs
    from (
      select
        id,
        coalesce(
          (
            select jsonb_object_agg(
              'cost_center_chain_level_' || lpad(key, 2, '0'),
              value
            )
            from jsonb_each_text(cost_center_chain) as e(key, value)
            where nullif(trim(value), '') is not null
          ),
          '{}'::jsonb
        ) as chain_attrs
      from contributors
      where org_id = ${orgId}::uuid
        and cost_center_chain is not null
        and cost_center_chain <> '{}'::jsonb
    ) sub
    where c.id = sub.id
      and sub.chain_attrs <> '{}'::jsonb
  `);

  const { profiles, rowCount } = await profileOrgAttributes(orgId);
  let config = mergeProfilesIntoConfig(org?.config, profiles, rowCount);

  const hadEnabled = (org?.config?.columns ?? []).some((c) => c.enabled);
  if (!hadEnabled && profiles.length > 0) {
    // Existing workspaces / sample: auto-enable legacy visible columns
    const looksLegacy = profiles.some(
      (p) =>
        p.key === "department" ||
        p.key === "cost_center" ||
        p.key.startsWith("cost_center_chain_level_")
    );
    if (looksLegacy) {
      config = autoEnableLegacyVisibleColumns(config);
    }
  }

  await db
    .update(s.organizations)
    .set({ peopleDimensionConfig: config })
    .where(eq(s.organizations.id, orgId));

  return config;
}

export async function getPeopleDimensionConfig(
  orgId: string
): Promise<PeopleDimensionConfig> {
  return ensurePeopleDimensionConfig(orgId);
}

export async function savePeopleDimensionConfig(
  orgId: string,
  patch: {
    columns: Array<{
      key: string;
      displayName?: string;
      enabled?: boolean;
      role?: "primary" | "secondary" | null;
    }>;
  }
): Promise<PeopleDimensionConfig> {
  const current = await ensurePeopleDimensionConfig(orgId);
  const byKey = new Map(current.columns.map((c) => [c.key, { ...c }]));

  for (const p of patch.columns) {
    const col = byKey.get(p.key);
    if (!col) continue;
    if (p.displayName !== undefined) col.displayName = p.displayName.trim() || col.sourceColumn;
    if (p.enabled !== undefined) {
      if (p.enabled && !isGroupingEligible(col.suggestion)) {
        throw new Error(
          `Column “${col.sourceColumn}” is classified as ${col.suggestion} and cannot be a grouping dimension`
        );
      }
      col.enabled = p.enabled;
      if (!col.enabled) col.role = null;
    }
    if (p.role !== undefined) col.role = p.role;
  }

  let config = normalizeRoles({
    ...current,
    columns: [...byKey.values()],
  });

  // If enabling without roles, assign primary/secondary by distinct count
  const enabled = config.columns.filter((c) => c.enabled);
  if (enabled.length > 0 && !enabled.some((c) => c.role === "primary")) {
    const sorted = [...enabled].sort((a, b) => a.distinctCount - b.distinctCount);
    const primaryKey = sorted[0]?.key;
    const secondaryKey = sorted[1]?.key;
    config = {
      ...config,
      columns: config.columns.map((c) => {
        if (c.key === primaryKey) return { ...c, role: "primary" as const };
        if (c.key === secondaryKey) return { ...c, role: "secondary" as const };
        if (c.role === "primary" || c.role === "secondary") {
          return { ...c, role: null };
        }
        return c;
      }),
    };
    config = normalizeRoles(config);
  }

  await db
    .update(s.organizations)
    .set({ peopleDimensionConfig: config })
    .where(eq(s.organizations.id, orgId));

  return config;
}

/** Enabled dimensions in Home card order: primary first, then secondary, then rest. */
export function enabledDimensionsInOrder(
  config: PeopleDimensionConfig
): PeopleDimensionColumnConfig[] {
  const enabled = config.columns.filter(
    (c) => c.enabled && isGroupingEligible(c.suggestion)
  );
  const primary = enabled.filter((c) => c.role === "primary");
  const secondary = enabled.filter((c) => c.role === "secondary");
  const rest = enabled.filter((c) => c.role !== "primary" && c.role !== "secondary");
  return [...primary, ...secondary, ...rest];
}
