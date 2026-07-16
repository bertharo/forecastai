import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getCurrentOrg } from "@/lib/queries/org";

export async function GET() {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 400 });
  const keys = await db
    .select({
      id: s.otelIngestKeys.id,
      label: s.otelIngestKeys.label,
      keyPrefix: s.otelIngestKeys.keyPrefix,
      envTag: s.otelIngestKeys.envTag,
      lastUsedAt: s.otelIngestKeys.lastUsedAt,
      createdAt: s.otelIngestKeys.createdAt,
      revokedAt: s.otelIngestKeys.revokedAt,
    })
    .from(s.otelIngestKeys)
    .where(eq(s.otelIngestKeys.orgId, org.id));
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as {
    label?: string;
    envTag?: string;
    rotateFromId?: string;
  };
  const rawKey = `meter_${body.envTag ?? "prod"}_${randomBytes(16).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const [row] = await db
    .insert(s.otelIngestKeys)
    .values({
      orgId: org.id,
      keyHash,
      keyPrefix: rawKey.slice(0, 12),
      label: body.label?.trim() || "Ingest key",
      envTag: body.envTag ?? "prod",
      createdBy: "demo",
      rotatedFromId: body.rotateFromId || null,
    })
    .returning();

  if (body.rotateFromId) {
    await db
      .update(s.otelIngestKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(s.otelIngestKeys.id, body.rotateFromId),
          eq(s.otelIngestKeys.orgId, org.id),
          isNull(s.otelIngestKeys.revokedAt)
        )
      );
  }

  await db.insert(s.auditLogs).values({
    orgId: org.id,
    actorLabel: "demo",
    action: body.rotateFromId ? "otel_key.rotated" : "otel_key.created",
    entityType: "otel_ingest_key",
    entityId: row.id,
    after: { label: row.label, envTag: row.envTag, prefix: row.keyPrefix },
  });

  return NextResponse.json({
    key: rawKey,
    id: row.id,
    prefix: row.keyPrefix,
    envTag: row.envTag,
  });
}
