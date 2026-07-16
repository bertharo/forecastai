import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getCurrentOrg } from "@/lib/queries/org";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 400 });
  const { id } = await ctx.params;
  await db
    .update(s.otelIngestKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(s.otelIngestKeys.id, id), eq(s.otelIngestKeys.orgId, org.id)));
  await db.insert(s.auditLogs).values({
    orgId: org.id,
    actorLabel: "demo",
    action: "otel_key.revoked",
    entityType: "otel_ingest_key",
    entityId: id,
  });
  return NextResponse.json({ ok: true });
}
