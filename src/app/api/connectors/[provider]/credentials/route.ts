import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getCurrentOrg } from "@/lib/queries/org";
import { encryptSecret } from "@/lib/crypto/secrets";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> }
) {
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 400 });
  const { provider } = await ctx.params;
  const body = (await req.json()) as { apiKey?: string; demoMode?: boolean };
  const [row] = await db
    .select({
      connectorId: s.connectors.id,
    })
    .from(s.connectors)
    .innerJoin(s.providers, eq(s.connectors.providerId, s.providers.id))
    .where(and(eq(s.connectors.orgId, org.id), eq(s.providers.key, provider)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "connector not found" }, { status: 404 });

  if (body.demoMode) {
    await db
      .update(s.connectors)
      .set({
        demoMode: true,
        credentialsEncrypted: null,
        credentialsKeyId: null,
        authConfig: { mock: true, mode: "api_key" },
      })
      .where(eq(s.connectors.id, row.connectorId));
    return NextResponse.json({ ok: true, demoMode: true });
  }

  if (!body.apiKey?.trim()) {
    return NextResponse.json({ error: "apiKey required" }, { status: 400 });
  }
  const { ciphertext, keyId } = encryptSecret(body.apiKey.trim());
  await db
    .update(s.connectors)
    .set({
      demoMode: false,
      credentialsEncrypted: ciphertext,
      credentialsKeyId: keyId,
      authConfig: { mode: "api_key", mock: false },
      status: "authenticating",
      healthMessage: "Credentials saved — run sync",
    })
    .where(eq(s.connectors.id, row.connectorId));

  await db.insert(s.auditLogs).values({
    orgId: org.id,
    actorLabel: "demo",
    action: "connector.credentials_set",
    entityType: "connector",
    entityId: row.connectorId,
    after: { provider, keyId },
  });

  return NextResponse.json({ ok: true, demoMode: false });
}
