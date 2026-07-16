import { NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import {
  getAllocationByConnector,
  getAllocationPct,
  getAllocationTrend,
  getUnallocatedClusters,
} from "@/lib/queries/allocation";

export async function GET() {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 404 });
  }
  const [clusters, pct, trend, byConnector] = await Promise.all([
    getUnallocatedClusters(org.id, 30),
    getAllocationPct(org.id, 30),
    getAllocationTrend(org.id, 30),
    getAllocationByConnector(org.id, 30),
  ]);
  return NextResponse.json({
    orgId: org.id,
    allocatedPct: pct.allocatedPct,
    clusters,
    trend,
    byConnector: byConnector.map((r) => ({
      connectorId: r.connectorId,
      providerKey: r.providerKey,
      providerName: r.providerName,
      total: Number(r.total),
      allocated: Number(r.allocated),
      allocatedPct: Number(r.total) ? Number(r.allocated) / Number(r.total) : 1,
      spend: Number(r.spend),
    })),
  });
}
