import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg, getDimensionNodes } from "@/lib/queries/org";
import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { upsertContributor } from "@/lib/contributors/upsert";
import { parseCsv } from "@/lib/import/parse";

export async function GET() {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });
  const rows = await db
    .select()
    .from(s.contributors)
    .where(eq(s.contributors.orgId, org.id))
    .orderBy(asc(s.contributors.displayName));
  return NextResponse.json({ contributors: rows });
}

export async function POST(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });

  const body = (await req.json()) as {
    action?: "upsert" | "csv";
    email?: string;
    displayName?: string;
    githubLogin?: string;
    teamKey?: string;
    csv?: string;
  };

  const nodes = await getDimensionNodes(org.id);
  const teamByKey = new Map(nodes.map((n) => [n.key, n]));

  if (body.action === "csv" && body.csv) {
    const { rows } = parseCsv(body.csv);
    let n = 0;
    for (const row of rows) {
      const email = (row.email || row.Email || "").trim();
      if (!email) continue;
      const teamKey = (row.team_key || row.team || "").trim();
      await upsertContributor(org.id, {
        email,
        displayName: row.display_name || row.name || email,
        githubLogin: (row.github_login || row.github || "").toLowerCase() || null,
        department: row.department || null,
        costCenter: row.cost_center || null,
        employmentStatus: row.employment_status || undefined,
        startedOn: row.started_on || null,
        endedOn: row.ended_on || null,
        dimensionNodeId: teamKey ? teamByKey.get(teamKey)?.id ?? null : null,
      });
      n++;
    }
    return NextResponse.json({ ok: true, upserted: n });
  }

  if (!body.email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  const teamKey = body.teamKey?.trim();
  const c = await upsertContributor(org.id, {
    email: body.email,
    displayName: body.displayName,
    githubLogin: body.githubLogin?.toLowerCase(),
    dimensionNodeId: teamKey ? teamByKey.get(teamKey)?.id ?? null : null,
  });
  return NextResponse.json({ contributor: c });
}
