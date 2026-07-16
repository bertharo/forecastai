import { NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { getDemoOrg } from "@/lib/queries/org";
import { ensureRegistry, listAdapters } from "@/lib/connectors";

export async function GET() {
  ensureRegistry();
  const org = await getDemoOrg();
  if (!org) return NextResponse.json({ connectors: [], adapters: listAdapters().map((a) => ({ key: a.providerKey, tier: a.tier })) });

  const rows = await db
    .select({
      connector: s.connectors,
      provider: s.providers,
    })
    .from(s.connectors)
    .innerJoin(s.providers, eq(s.connectors.providerId, s.providers.id))
    .where(eq(s.connectors.orgId, org.id));

  return NextResponse.json({
    connectors: rows.map((r) => ({
      id: r.connector.id,
      provider: r.provider.key,
      displayName: r.provider.displayName,
      tier: r.connector.tier,
      status: r.connector.status,
      lastSyncedAt: r.connector.lastSyncedAt,
      spendCoveredPct: r.connector.spendCoveredPct,
      allocatedPct: r.connector.allocatedPct,
    })),
    adapters: listAdapters().map((a) => ({
      key: a.providerKey,
      tier: a.tier,
      displayName: a.displayName,
    })),
  });
}
