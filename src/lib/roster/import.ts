import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseCsv } from "@/lib/import/parse";
import { upsertContributor } from "@/lib/contributors/upsert";

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

/** Common HRIS / Excel header aliases → canonical field */
const ALIASES: Record<keyof RosterColumnMap, string[]> = {
  email: ["email", "work_email", "user_email", "e-mail", "mail"],
  display_name: [
    "display_name",
    "name",
    "full_name",
    "employee_name",
    "preferred_name",
  ],
  department: ["department", "dept", "dept_name", "org_unit", "division"],
  cost_center: ["cost_center", "cost_center_code", "cc", "costcentre", "cost_centre"],
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
  return h
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_");
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
    const alias = ALIASES[field].find((a) => present.has(a));
    if (alias) resolved[field] = alias;
  }
  return resolved;
}

function cell(row: Record<string, string>, col?: string) {
  if (!col) return "";
  return (row[col] ?? row[normHeader(col)] ?? "").trim();
}

function asDateOrNull(raw: string): string | null {
  if (!raw) return null;
  // Accept YYYY-MM-DD or ISO; reject junk so one bad cell doesn't kill the batch
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

  if (!map.email || !normalizedHeaders.includes(normHeader(map.email))) {
    return {
      upserted: 0,
      rows: rawRows.length,
      skipped: rawRows.length,
      errors: [
        {
          row: 0,
          message: `No email column found. Saw: ${normalizedHeaders.join(", ") || "(none)"}. Need a column like email / work_email.`,
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
    const email = cell(row, map.email).toLowerCase();
    if (!email) {
      skipped++;
      continue;
    }
    if (!email.includes("@")) {
      skipped++;
      errors.push({ row: rowNum, message: `Not an email: ${email}` });
      continue;
    }

    try {
      const teamKey = cell(row, map.team_key);
      await upsertContributor(orgId, {
        email,
        displayName: cell(row, map.display_name) || email.split("@")[0],
        department: cell(row, map.department) || null,
        costCenter: cell(row, map.cost_center) || null,
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
