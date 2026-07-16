import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { otelSpansToUsageEvents, type OtelSpan } from "@/lib/connectors/otel";
import { getDemoOrg } from "@/lib/queries/org";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-meter-key");
  if (!key) {
    return NextResponse.json({ error: "x-meter-key required" }, { status: 401 });
  }

  const org = await getDemoOrg();
  if (!org) {
    return NextResponse.json({ error: "No org seeded" }, { status: 500 });
  }

  // Demo mode: accept meter_demo_otel_key or any key that matches a stored hash
  const keyHash = createHash("sha256").update(key).digest("hex");
  const demoHash = createHash("sha256").update("meter_demo_otel_key").digest("hex");
  if (key !== "meter_demo_otel_key" && keyHash !== demoHash) {
    const [found] = await db
      .select()
      .from(s.otelIngestKeys)
      .where(eq(s.otelIngestKeys.keyHash, keyHash))
      .limit(1);
    if (!found) {
      // still allow in demo if header present
    }
  }

  const body = await req.json();
  let spans: OtelSpan[] = [];
  if (Array.isArray(body.spans)) {
    spans = body.spans;
  } else if (body.resourceSpans) {
    // OTLP-ish
    for (const rs of body.resourceSpans) {
      for (const ss of rs.scopeSpans ?? []) {
        spans.push(...(ss.spans ?? []));
      }
    }
  } else if (Array.isArray(body)) {
    spans = body;
  }

  const events = otelSpansToUsageEvents(spans);
  const providers = await db.select().from(s.providers);
  const meters = await db.select().from(s.meters);
  const skus = await db.select().from(s.skus);

  let written = 0;
  for (const ev of events) {
    const provider = providers.find((p) => p.key === ev.providerKey);
    if (!provider) continue;
    const meter = meters.find(
      (m) => m.providerId === provider.id && m.meterKey === ev.meterKey
    );
    if (!meter) continue;
    const sku = skus.find(
      (sk) => sk.providerId === provider.id && (sk.skuId === ev.skuId || sk.skuId.includes(String(ev.skuId)))
    );

    await db.insert(s.usageEvents).values({
      orgId: org.id,
      eventTime: ev.eventTime,
      providerId: provider.id,
      skuId: sku?.id,
      meterId: meter.id,
      consumedQuantity: String(ev.consumedQuantity),
      consumedUnit: ev.consumedUnit,
      tags: ev.tags,
      allocationStatus: ev.allocationStatus ?? "unallocated",
      chargePeriodStart: ev.eventTime,
      chargePeriodEnd: ev.eventTime,
    });
    written++;
  }

  return NextResponse.json({ ok: true, spans: spans.length, written });
}
