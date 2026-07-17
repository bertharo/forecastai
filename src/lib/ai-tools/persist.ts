import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "crypto";

export type AiToolDailyRow = {
  day: string; // YYYY-MM-DD
  toolKey: string;
  contributorId?: string | null;
  dimensionNodeId?: string | null;
  spend: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensTotal?: number;
  sessions?: number;
  requests?: number;
  sourceConnector: string;
};

export async function upsertAiToolDaily(orgId: string, rows: AiToolDailyRow[]) {
  let written = 0;
  for (const r of rows) {
    const contributorKey = r.contributorId ?? "unattributed";
    const contentHash = createHash("sha256")
      .update(
        [
          orgId,
          r.day,
          r.toolKey,
          contributorKey,
          r.sourceConnector,
          r.spend,
          r.tokensTotal ?? 0,
        ].join("|")
      )
      .digest("hex");

    const existing = await db
      .select({ id: s.aiToolDaily.id })
      .from(s.aiToolDaily)
      .where(
        and(
          eq(s.aiToolDaily.orgId, orgId),
          eq(s.aiToolDaily.day, r.day),
          eq(s.aiToolDaily.toolKey, r.toolKey),
          eq(s.aiToolDaily.contributorKey, contributorKey)
        )
      )
      .limit(1);

    const values = {
      orgId,
      day: r.day,
      toolKey: r.toolKey,
      contributorKey,
      contributorId: r.contributorId ?? null,
      dimensionNodeId: r.dimensionNodeId ?? null,
      spend: String(r.spend),
      tokensIn: String(r.tokensIn ?? 0),
      tokensOut: String(r.tokensOut ?? 0),
      tokensTotal: String(r.tokensTotal ?? (r.tokensIn ?? 0) + (r.tokensOut ?? 0)),
      sessions: r.sessions ?? 0,
      requests: r.requests ?? 0,
      sourceConnector: r.sourceConnector,
      contentHash,
    };

    if (existing[0]) {
      await db
        .update(s.aiToolDaily)
        .set(values)
        .where(eq(s.aiToolDaily.id, existing[0].id));
    } else {
      await db.insert(s.aiToolDaily).values(values);
    }
    written++;
  }
  return { written };
}

/** Detect overlapping sources for the same tool/day (dedup warning). */
export async function findOverlappingAiSources(orgId: string, days = 30) {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);
  const fromStr = from.toISOString().slice(0, 10);

  const rows = await db
    .select({
      day: s.aiToolDaily.day,
      toolKey: s.aiToolDaily.toolKey,
      sources: sql<string>`string_agg(distinct ${s.aiToolDaily.sourceConnector}, ',')`,
      n: sql<number>`count(distinct ${s.aiToolDaily.sourceConnector})`,
    })
    .from(s.aiToolDaily)
    .where(and(eq(s.aiToolDaily.orgId, orgId), sql`${s.aiToolDaily.day} >= ${fromStr}`))
    .groupBy(s.aiToolDaily.day, s.aiToolDaily.toolKey)
    .having(sql`count(distinct ${s.aiToolDaily.sourceConnector}) > 1`)
    .orderBy(sql`${s.aiToolDaily.day} desc`)
    .limit(20);

  return rows.map((r) => ({
    day: String(r.day),
    tool_key: r.toolKey,
    sources: (r.sources ?? "").split(",").filter(Boolean),
  }));
}
