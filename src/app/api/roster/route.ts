import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import { importRosterFile, type RosterColumnMap } from "@/lib/roster/import";
import { db } from "@/db";
import * as s from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET() {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });

  const [countRow] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.contributors)
    .where(eq(s.contributors.orgId, org.id));

  const sample = await db
    .select({
      email: s.contributors.email,
      displayName: s.contributors.displayName,
      attributes: s.contributors.attributes,
      employmentStatus: s.contributors.employmentStatus,
      endedOn: s.contributors.endedOn,
    })
    .from(s.contributors)
    .where(eq(s.contributors.orgId, org.id))
    .orderBy(asc(s.contributors.displayName))
    .limit(20);

  return NextResponse.json({
    count: Number(countRow?.n ?? 0),
    sample,
    templateHeaders: ["Email", "Project Worker", "Business Unit", "Team", "Cost Center"],
    acceptedFormats: [".csv", ".xlsx", ".xls", ".xlsm"],
  });
}

export async function POST(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });

  const body = (await req.json()) as {
    csv?: string;
    content?: string;
    base64?: string;
    fileName?: string;
    columnMap?: Partial<RosterColumnMap>;
  };

  const content = body.content ?? body.csv;
  if (!content?.trim() && !body.base64) {
    return NextResponse.json(
      { error: "csv/content or base64 (Excel) required" },
      { status: 400 }
    );
  }

  const [orgMeta] = await db
    .select({ sampleAt: s.organizations.sampleDataLoadedAt })
    .from(s.organizations)
    .where(eq(s.organizations.id, org.id))
    .limit(1);
  if (orgMeta?.sampleAt) {
    return NextResponse.json(
      {
        error: "sample_active",
        message:
          "Sample data is active. Clear or reset the sample pack before uploading a people CSV.",
      },
      { status: 409 }
    );
  }

  try {
    const result = await importRosterFile(org.id, {
      content,
      base64: body.base64,
      fileName: body.fileName,
      columnMap: body.columnMap,
    });
    const ok = result.upserted > 0;
    return NextResponse.json(
      { ok, ...result },
      { status: ok ? 200 : 400 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
