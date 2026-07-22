/**
 * Level-family detection — recognizes Workday-style leveled hierarchy columns
 * (e.g. "Cost Center Chain - Level 02" … "Level 07", "Sup Org L1..L5") in a
 * people CSV and treats them as ONE drillable hierarchy instead of N
 * unrelated flat dimensions. Pure functions; no DB access.
 */
import type { PeopleDimensionColumnConfig } from "@/db/schema";
import { normalizeHeaderKey } from "@/lib/import/telemetry";

export type LevelColumn = {
  /** contributors.attributes key */
  key: string;
  level: number;
  displayName: string;
};

export type LevelFamily = {
  /** Normalized shared prefix, e.g. "cost_center_chain" */
  base: string;
  /** Human label derived from the shared prefix, e.g. "Cost center chain" */
  displayName: string;
  /** Ascending by level */
  levels: LevelColumn[];
};

/**
 * "cost_center_chain_level_02" → { base: "cost_center_chain", level: 2 }.
 * Accepts level/lvl separators with optional zero padding; requires the
 * level marker so plain numbered columns ("address_2") don't match.
 */
export function parseLevelKey(
  key: string
): { base: string; level: number } | null {
  const norm = normalizeHeaderKey(key);
  const m = norm.match(/^(.*?)[_]*(?:level|lvl|l)[_]*0*(\d{1,2})$/);
  if (!m) return null;
  const base = m[1].replace(/_+$/, "");
  if (!base) return null;
  const level = Number(m[2]);
  if (!Number.isFinite(level)) return null;
  return { base, level };
}

function titleFromBase(base: string): string {
  const words = base.split("_").filter(Boolean);
  if (words.length === 0) return base;
  const label = words.join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Groups grouping-eligible people-CSV columns into level families.
 * A family needs ≥2 distinct levels; singletons stay flat dimensions.
 */
export function detectLevelFamilies(
  columns: Pick<PeopleDimensionColumnConfig, "key" | "displayName">[]
): LevelFamily[] {
  const byBase = new Map<string, LevelColumn[]>();
  for (const col of columns) {
    const parsed = parseLevelKey(col.key);
    if (!parsed) continue;
    const list = byBase.get(parsed.base) ?? [];
    list.push({ key: col.key, level: parsed.level, displayName: col.displayName });
    byBase.set(parsed.base, list);
  }

  const families: LevelFamily[] = [];
  for (const [base, levels] of byBase) {
    const distinct = new Map<number, LevelColumn>();
    for (const l of levels) if (!distinct.has(l.level)) distinct.set(l.level, l);
    if (distinct.size < 2) continue;
    families.push({
      base,
      displayName: titleFromBase(base),
      levels: [...distinct.values()].sort((a, b) => a.level - b.level),
    });
  }
  return families.sort((a, b) => b.levels.length - a.levels.length);
}

/**
 * A contributor's org path under a family: level values in order, truncated
 * at the first blank (Workday leaves deeper levels empty for shallow
 * branches). Empty array = unallocated in this hierarchy.
 */
export function pathForAttributes(
  attributes: Record<string, string>,
  family: LevelFamily
): string[] {
  const path: string[] = [];
  for (const level of family.levels) {
    const v = (attributes[level.key] ?? "").trim();
    if (!v) break;
    path.push(v);
  }
  return path;
}
