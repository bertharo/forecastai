import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import { getAiCostSummary } from "@/lib/queries/ai-cost";
import { findOverlappingAiSources } from "@/lib/ai-tools/persist";

export async function GET(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No workspace" }, { status: 401 });
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const toolKey = req.nextUrl.searchParams.get("tool");
  const teamNodeId = req.nextUrl.searchParams.get("team");
  const summary = await getAiCostSummary(org.id, {
    days,
    toolKey,
    teamNodeId,
  });
  const overlaps = await findOverlappingAiSources(org.id, days);
  return NextResponse.json({ ...summary, overlaps });
}
