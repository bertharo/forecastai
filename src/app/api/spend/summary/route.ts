import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import { parseAnalyticsFilters } from "@/lib/queries/filters";
import { getSpendSummary } from "@/lib/queries/spend";

export async function GET(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });

  const filters = parseAnalyticsFilters(
    Object.fromEntries(req.nextUrl.searchParams.entries())
  );
  const summary = await getSpendSummary(org.id, filters);
  return NextResponse.json(summary);
}
