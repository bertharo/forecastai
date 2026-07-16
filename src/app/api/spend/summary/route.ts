import { NextRequest, NextResponse } from "next/server";
import { getDemoOrg } from "@/lib/queries/org";
import { getSpendSummary } from "@/lib/queries/spend";

export async function GET(req: NextRequest) {
  const org = await getDemoOrg();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 500 });
  const node = req.nextUrl.searchParams.get("node") ?? undefined;
  const summary = await getSpendSummary(org.id, node);
  return NextResponse.json(summary);
}
