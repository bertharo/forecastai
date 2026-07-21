import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { type RawRow } from "@/lib/import/parse";
import { upsertContributor } from "@/lib/contributors/upsert";
import { normalizeHeaderKey } from "@/lib/import/telemetry";
import { parseTabularUpload, rowsToCsv } from "@/lib/import/spreadsheet";
import {
  attributesFromRow,
  ensurePeopleDimensionConfig,
  isIdentityColumnKey,
  mergeProfilesIntoConfig,
  profileAttributeColumns,
  autoEnableLegacyVisibleColumns,
} from "@/lib/roster/dimensions";

export type RosterColumnMap = {
  email: string;
  display_name?: string;
  employment_status?: string;
  started_on?: string;
  ended_on?: string;
  team_key?: string;
};

const DEFAULT_MAP: RosterColumnMap = {
  email: "email",
  display_name: "display_name",
  employment_status: "employment_status",
  started_on: "started_on",
  ended_on: "ended_on",
  team_key: "team_key",
};

/** Common HRIS / Excel header aliases → canonical field (matched after normalizeHeaderKey). */
const ALIASES: Record<keyof RosterColumnMap, string[]> = {
  email: [
    "email",
    "work_email",
    "user_email",
    "e-mail",
    "mail",
    // Fallback when the sheet only has Project Worker (email in that column)
    "project_worker",
  ],
  display_name: [
    "display_name",
    "name",
    "full_name",
    "employee_name",
    "preferred_name",
    "project_worker", // name when Email column is also present
  ],
  employment_status: [
    "employment_status",
    "status",
    "employee_status",
    "hr_status",
    "worker_status",
  ],
  started_on: [
    "started_on",
    "start_date",
    "hire_date",
    "start",
    "employment_start",
  ],
  ended_on: [
    "ended_on",
    "end_date",
    "termination_date",
    "term_date",
    "employment_end",
  ],
  team_key: ["team_key", "team", "team_id", "team_name", "squad"],
};

function normHeader(h: string) {
  return normalizeHeaderKey(h);
}

function normalizeRows(headers: string[], rows: Record<string, string>[]) {
  const headerMap = headers.map((h) => ({ raw: h, key: normHeader(h) }));
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const { raw, key } of headerMap) {
      out[key] = (row[raw] ?? "").trim();
    }
    return out;
  });
}

function resolveMap(
  normalizedHeaders: string[],
  columnMap?: Partial<RosterColumnMap>
): RosterColumnMap {
  const present = new Set(normalizedHeaders);
  const resolved = { ...DEFAULT_MAP, ...columnMap };

  for (const field of Object.keys(ALIASES) as (keyof RosterColumnMap)[]) {
    const current = resolved[field];
    if (current && present.has(normHeader(current))) {
      resolved[field] = normHeader(current);
      continue;
    }
    const alias = ALIASES[field].find((a) => present.has(normHeader(a)));
    if (alias) resolved[field] = normHeader(alias);
  }
  return resolved;
}

function cell(row: Record<string, string>, col?: string) {
  if (!col) return "";
  return (row[col] ?? row[normHeader(col)] ?? "").trim();
}

function asDateOrNull(raw: string): string | null {
  if (!raw) return null;
  const d = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(d);
  if (Number.isNaN(t)) return null;
  return d;
}

/** Map normalized key → original header for profiling / config. */
function sourceColumnMap(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    const key = normHeader(h);
    if (!out[key]) out[key] = h.trim() || key;
  }
  return out;
}

export type RosterImportResult = {
  upserted: number;
  rows: number;
  skipped: number;
  errors: { row: number; message: string }[];
  detected: Partial<RosterColumnMap>;
  attributeKeys: string[];
};

/** Import HRIS roster from CSV text or Excel bytes. */
export async function importRosterCsv(
  orgId: string,
  csv: string,
  columnMap?: Partial<RosterColumnMap>
): Promise<RosterImportResult> {
  return importRosterFile(orgId, { content: csv, fileName: "roster.csv", columnMap });
}

export async function importRosterFile(
  orgId: string,
  opts: {
    content?: string;
    base64?: string;
    fileName?: string;
    columnMap?: Partial<RosterColumnMap>;
  }
): Promise<RosterImportResult> {
  let headers: string[] = [];
  let rawRows: RawRow[] = [];
  try {
    const parsed = parseTabularUpload({
      fileName: opts.fileName || (opts.base64 ? "roster.xlsx" : "roster.csv"),
      content: opts.content,
      base64: opts.base64,
    });
    headers = parsed.headers;
    rawRows = parsed.rows;
  } catch (e) {
    return {
      upserted: 0,
      rows: 0,
      skipped: 0,
      errors: [
        {
          row: 0,
          message: e instanceof Error ? e.message : String(e),
        },
      ],
      detected: {},
      attributeKeys: [],
    };
  }

  if (!headers.length) {
    return {
      upserted: 0,
      rows: 0,
      skipped: 0,
      errors: [{ row: 0, message: "File looks empty — need a header row" }],
      detected: {},
      attributeKeys: [],
    };
  }

  const rows = normalizeRows(headers, rawRows);
  const normalizedHeaders = headers.map(normHeader);
  const map = resolveMap(normalizedHeaders, opts.columnMap);
  const sources = sourceColumnMap(headers);

  // project_worker used as email is identity; if a separate email exists, still skip as name-only identity
  const excludeKeys = new Set<string>();
  if (map.email) excludeKeys.add(normHeader(map.email));
  if (map.display_name) excludeKeys.add(normHeader(map.display_name));
  for (const k of Object.keys(sources)) {
    if (isIdentityColumnKey(k)) excludeKeys.add(k);
  }

  const attributeKeys = Object.keys(sources).filter((k) => !excludeKeys.has(k));

  if (!map.email || !normalizedHeaders.includes(normHeader(map.email))) {
    return {
      upserted: 0,
      rows: rawRows.length,
      skipped: rawRows.length,
      errors: [
        {
          row: 0,
          message: `No email / Project worker column found. Saw: ${normalizedHeaders.join(", ") || "(none)"}. Need email or Project worker.`,
        },
      ],
      detected: map,
      attributeKeys,
    };
  }

  const nodes = await db
    .select()
    .from(s.dimensionNodes)
    .where(eq(s.dimensionNodes.orgId, orgId));
  const byKey = new Map(nodes.map((n) => [n.key, n]));

  let upserted = 0;
  let skipped = 0;
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const worker = cell(row, map.email);
    const email = worker.toLowerCase();

    if (!worker) {
      skipped++;
      continue;
    }

    // Project worker may be a name — require @ for spend join
    if (!email.includes("@")) {
      skipped++;
      errors.push({
        row: rowNum,
        message: `Project worker must be an email to join spend (got “${worker}”)`,
      });
      continue;
    }

    try {
      const teamKey = cell(row, map.team_key);
      const rawName = cell(row, map.display_name);
      const displayName =
        rawName && rawName.toLowerCase() !== email ? rawName : email.split("@")[0];
      const attributes = attributesFromRow(row, attributeKeys);
      await upsertContributor(orgId, {
        email,
        displayName,
        attributes,
        employmentStatus: cell(row, map.employment_status) || "active",
        startedOn: asDateOrNull(cell(row, map.started_on)),
        endedOn: asDateOrNull(cell(row, map.ended_on)),
        dimensionNodeId: teamKey ? byKey.get(teamKey)?.id ?? null : null,
      });
      upserted++;
    } catch (e) {
      skipped++;
      errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (upserted === 0 && rawRows.length > 0 && errors.length === 0) {
    errors.push({
      row: 0,
      message:
        "No people imported — every row was missing an email. Check the column headers.",
    });
  }

  // Profile + persist dimension config (preserve prior enable/rename when re-importing)
  if (upserted > 0) {
    const profiles = profileAttributeColumns(rows, sources, { excludeKeys });
    const [org] = await db
      .select({ config: s.organizations.peopleDimensionConfig })
      .from(s.organizations)
      .where(eq(s.organizations.id, orgId))
      .limit(1);

    let config = mergeProfilesIntoConfig(org?.config, profiles, rows.length);
    const hadEnabled = (org?.config?.columns ?? []).some((c) => c.enabled);
    if (!hadEnabled) {
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

    // Also run ensure to backfill any leftover legacy rows
    await ensurePeopleDimensionConfig(orgId);
  }

  return {
    upserted,
    rows: rawRows.length,
    skipped,
    errors: errors.slice(0, 40),
    detected: map,
    attributeKeys,
  };
}

/** @internal test helper */
export function rosterFileToCsvPreview(opts: {
  content?: string;
  base64?: string;
  fileName?: string;
}): string {
  const parsed = parseTabularUpload({
    fileName: opts.fileName || "roster.csv",
    content: opts.content,
    base64: opts.base64,
  });
  return rowsToCsv(parsed.headers, parsed.rows);
}
