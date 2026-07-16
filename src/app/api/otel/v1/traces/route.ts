import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { otelSpansToUsageEvents, type OtelSpan } from "@/lib/connectors/otel";
import { persistUsageEvents } from "@/lib/ingest/persist";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-meter-key");
  if (!key) {
    return NextResponse.json({ error: "x-meter-key required" }, { status: 401 });
  }

  const keyHash = createHash("sha256").update(key).digest("hex");
  const demoHash = createHash("sha256").update("meter_demo_otel_key").digest("hex");

  let orgId: string | null = null;

  const [found] = await db
    .select()
    .from(s.otelIngestKeys)
    .where(
      and(eq(s.otelIngestKeys.keyHash, keyHash), isNull(s.otelIngestKeys.revokedAt))
    )
    .limit(1);

  if (found) {
    orgId = found.orgId;
    await db
      .update(s.otelIngestKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(s.otelIngestKeys.id, found.id));
  } else if (key === "meter_demo_otel_key" || keyHash === demoHash) {
    const [demo] = await db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.slug, "northstar"))
      .limit(1);
    orgId = demo?.id ?? null;
    if (!orgId) {
      const [any] = await db.select().from(s.organizations).limit(1);
      orgId = any?.id ?? null;
    }
  }

  if (!orgId) {
    return NextResponse.json({ error: "invalid x-meter-key" }, { status: 401 });
  }

  const body = await req.json();
  let spans: OtelSpan[] = [];
  if (Array.isArray(body.spans)) {
    spans = body.spans;
  } else if (body.resourceSpans) {
    for (const rs of body.resourceSpans) {
      for (const ss of rs.scopeSpans ?? []) {
        spans.push(...(ss.spans ?? []));
      }
    }
  } else if (Array.isArray(body)) {
    spans = body;
  }

  const events = otelSpansToUsageEvents(spans);
  const result = await persistUsageEvents(orgId, events);

  return NextResponse.json({
    ok: true,
    orgId,
    spans: spans.length,
    ...result,
  });
}
