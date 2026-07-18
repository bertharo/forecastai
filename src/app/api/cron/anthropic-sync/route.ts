import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { runConnectorSync } from "@/lib/connectors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorize(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Local/dev: allow without secret so `curl` works; prod must set CRON_SECRET.
    return process.env.NODE_ENV !== "production";
  }
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const q = req.nextUrl.searchParams.get("secret");
  return q === secret;
}

/**
 * Vercel Cron: every 6h (see vercel.json).
 * Incremental Anthropic Admin sync (7d lookback) for every org connector.
 */
export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connectors = await db
    .select({
      orgId: s.connectors.orgId,
      connectorId: s.connectors.id,
      demoMode: s.connectors.demoMode,
      hasKey: s.connectors.credentialsEncrypted,
    })
    .from(s.connectors)
    .innerJoin(s.providers, eq(s.connectors.providerId, s.providers.id))
    .where(eq(s.providers.key, "anthropic"));

  const results: {
    orgId: string;
    ok: boolean;
    written?: number;
    upserted?: number;
    error?: string;
  }[] = [];

  for (const c of connectors) {
    try {
      const { persisted } = await runConnectorSync(
        "anthropic",
        c.orgId,
        "incremental"
      );
      results.push({
        orgId: c.orgId,
        ok: true,
        written: persisted.written,
        upserted: persisted.upserted,
      });
    } catch (e) {
      results.push({
        orgId: c.orgId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    syncedAt: new Date().toISOString(),
    connectors: connectors.length,
    results,
  });
}
