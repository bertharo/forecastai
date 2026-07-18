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

function cell(row: Record<string, string>, col?: string) {
  if (!col) return "";
  return (row[col] ?? row[col.toLowerCase()] ?? "").trim();
}

/** Import HRIS roster CSV into contributors. */
export async function importRosterCsv(
  orgId: string,
  csv: string,
  columnMap?: Partial<RosterColumnMap>
) {
  const map = { ...DEFAULT_MAP, ...columnMap };
  const { rows } = parseCsv(csv);
  const nodes = await db
    .select()
    .from(s.dimensionNodes)
    .where(eq(s.dimensionNodes.orgId, orgId));
  const byKey = new Map(nodes.map((n) => [n.key, n]));

  let upserted = 0;
  for (const row of rows) {
    const email = cell(row, map.email);
    if (!email) continue;
    const teamKey = cell(row, map.team_key);
    await upsertContributor(orgId, {
      email,
      displayName: cell(row, map.display_name) || email.split("@")[0],
      department: cell(row, map.department) || null,
      costCenter: cell(row, map.cost_center) || null,
      employmentStatus: cell(row, map.employment_status) || "active",
      startedOn: cell(row, map.started_on) || null,
      endedOn: cell(row, map.ended_on) || null,
      dimensionNodeId: teamKey ? byKey.get(teamKey)?.id ?? null : null,
    });
    upserted++;
  }
  return { upserted, rows: rows.length };
}
