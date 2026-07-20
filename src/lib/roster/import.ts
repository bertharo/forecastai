import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseCsv } from "@/lib/import/parse";
import { upsertContributor } from "@/lib/contributors/upsert";
import { normalizeHeaderKey } from "@/lib/import/telemetry";

export type RosterColumnMap = {
  email: string;
  display_name?: string;
  department?: string;
  cost_center?: string;
  employment_status?: string;
  started_on?: string;
  ended_on?: string;
  team_key?: string;
};

const DEFAULT_MAP: RosterColumnMap = {
  email: "email",
  display_name: "display_name",
  department: "department",
  cost_center: "cost_center",
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
    "project_worker", // enterprise people export
  ],
  display_name: [
    "display_name",
    "name",
    "full_name",
    "employee_name",
    "preferred_name",
    "project_worker",
  ],
  department: [
    "department",
    "dept",
    "dept_name",
    "org_unit",
    "division",
    "cost_center_chain_level_04",
    "cost_center_chain_level_03",
  ],
  cost_center: [
    "cost_center",
    "cost_center_code",
    "cc",
    "costcentre",
    "cost_centre",
    "cost_center_chain_level_07",
    "cost_center_chain_level_06",
    "cost_center_chain_level_05",
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

const CHAIN_LEVELS = [
  "cost_center_chain_level_02",
  "cost_center_chain_level_03",
  "cost_center_chain_level_04",
  "cost_center_chain_level_05",
  "cost_center_chain_level_06",
  "cost_center_chain_level_07",
] as const;

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

/** Department from mid chain; cost center from deepest non-empty level. */
function fromCostCenterChain(row: Record<string, string>): {
  department: string | null;
  costCenter: string | null;
} {
  const levels = CHAIN_LEVELS.map((k) => ({ key: k, value: cell(row, k) }));
  const filled = levels.filter((l) => l.value);
  if (!filled.length) return { department: null, costCenter: null };

  const dept =
    cell(row, "cost_center_chain_level_04") ||
    cell(row, "cost_center_chain_level_03") ||
    cell(row, "cost_center_chain_level_05") ||
    filled[0].value;

  const costCenter = [...filled].reverse()[0]?.value ?? null;
  return { department: dept || null, costCenter };
}

function asDateOrNull(raw: string): string | null {
  if (!raw) return null;
  const d = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(d);
  if (Number.isNaN(t)) return null;
  return d;
}

export type RosterImportResult = {
  upserted: number;
  rows: number;
  skipped: number;
  errors: { row: number; message: string }[];
  detected: Partial<RosterColumnMap>;
};

/** Import HRIS roster CSV into contributors. */
export async function importRosterCsv(
  orgId: string,
  csv: string,
  columnMap?: Partial<RosterColumnMap>
): Promise<RosterImportResult> {
  const { headers, rows: rawRows } = parseCsv(csv);
  if (!headers.length) {
    return {
      upserted: 0,
      rows: 0,
      skipped: 0,
      errors: [{ row: 0, message: "File looks empty — need a header row" }],
      detected: {},
    };
  }

  const rows = normalizeRows(headers, rawRows);
  const normalizedHeaders = headers.map(normHeader);
  const map = resolveMap(normalizedHeaders, columnMap);
  const hasChain = CHAIN_LEVELS.some((k) => normalizedHeaders.includes(k));

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
    const email = worker.includes("@") ? worker.toLowerCase() : worker.toLowerCase();

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
      const chain = hasChain ? fromCostCenterChain(row) : { department: null, costCenter: null };
      const teamKey = cell(row, map.team_key);
      const rawName = cell(row, map.display_name);
      const displayName =
        rawName && rawName.toLowerCase() !== email ? rawName : email.split("@")[0];
      await upsertContributor(orgId, {
        email,
        displayName,
        department: cell(row, map.department) || chain.department,
        costCenter: cell(row, map.cost_center) || chain.costCenter,
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

  return {
    upserted,
    rows: rawRows.length,
    skipped,
    errors: errors.slice(0, 40),
    detected: map,
  };
}
