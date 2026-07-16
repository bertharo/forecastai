import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, isNotNull, ne } from "drizzle-orm";

export type StaleConnector = {
  id: string;
  providerKey: string;
  displayName: string;
  lastSyncedAt: Date | null;
  hoursAgo: number;
  staleAfterHours: number;
  healthMessage: string | null;
};

export async function getStaleConnectors(orgId: string): Promise<StaleConnector[]> {
  const rows = await db
    .select({
      id: s.connectors.id,
      providerKey: s.providers.key,
      displayName: s.providers.displayName,
      lastSyncedAt: s.connectors.lastSyncedAt,
      staleAfterHours: s.connectors.staleAfterHours,
      healthMessage: s.connectors.healthMessage,
      status: s.connectors.status,
    })
    .from(s.connectors)
    .innerJoin(s.providers, eq(s.connectors.providerId, s.providers.id))
    .where(
      and(eq(s.connectors.orgId, orgId), ne(s.connectors.status, "disconnected"))
    );

  const now = Date.now();
  const stale: StaleConnector[] = [];
  for (const r of rows) {
    if (!r.lastSyncedAt) continue;
    const hoursAgo = (now - r.lastSyncedAt.getTime()) / 3600_000;
    if (hoursAgo >= r.staleAfterHours || r.status === "stale") {
      stale.push({
        id: r.id,
        providerKey: r.providerKey,
        displayName: r.displayName,
        lastSyncedAt: r.lastSyncedAt,
        hoursAgo: Math.round(hoursAgo),
        staleAfterHours: r.staleAfterHours,
        healthMessage: r.healthMessage,
      });
      if (r.status !== "stale") {
        await db
          .update(s.connectors)
          .set({ status: "stale" })
          .where(and(eq(s.connectors.id, r.id), isNotNull(s.connectors.lastSyncedAt)));
      }
    }
  }
  return stale;
}
