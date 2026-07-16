import { registerAdapter } from "./registry";
import { anthropicAdapter } from "./anthropic";
import { openaiAdapter } from "./openai";
import { cursorAdapter } from "./cursor";
import { stubAdapters } from "./stubs";
import { getAdapter, listAdapters } from "./registry";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto/secrets";
import { persistUsageEvents } from "@/lib/ingest/persist";

let registered = false;

export function ensureRegistry() {
  if (registered) return;
  registerAdapter(anthropicAdapter);
  registerAdapter(openaiAdapter);
  registerAdapter(cursorAdapter);
  for (const stub of stubAdapters) registerAdapter(stub);
  registered = true;
}

export async function runConnectorSync(
  providerKey: string,
  orgId: string,
  phase: "backfill" | "incremental" = "incremental",
  opts?: { backfillDays?: number }
) {
  ensureRegistry();
  const adapter = getAdapter(providerKey);
  if (!adapter) throw new Error(`Unknown provider: ${providerKey}`);

  const [connector] = await db
    .select()
    .from(s.connectors)
    .innerJoin(s.providers, eq(s.connectors.providerId, s.providers.id))
    .where(and(eq(s.providers.key, providerKey), eq(s.connectors.orgId, orgId)))
    .limit(1);

  if (!connector) throw new Error(`No connector for ${providerKey} on this org`);

  let apiKey: string | undefined;
  if (connector.connectors.credentialsEncrypted) {
    try {
      apiKey = decryptSecret(connector.connectors.credentialsEncrypted);
    } catch {
      apiKey = undefined;
    }
  }

  const config = {
    mock: connector.connectors.demoMode || !apiKey,
    demoMode: connector.connectors.demoMode,
    apiKey,
    ...(connector.connectors.authConfig ?? {}),
  };

  const days =
    opts?.backfillDays ??
    (phase === "backfill" ? 365 : 7);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - Math.min(days, 365));

  const result =
    phase === "backfill"
      ? await adapter.backfill(config, since)
      : await adapter.incremental(config, since);

  let persisted = { written: 0, costed: 0, allocated: 0 };
  if (result.events.length > 0) {
    persisted = await persistUsageEvents(orgId, result.events);
  }

  const [run] = await db
    .insert(s.connectorSyncRuns)
    .values({
      connectorId: connector.connectors.id,
      phase,
      finishedAt: new Date(),
      rowsIn: result.rowsIn,
      rowsWritten: persisted.written,
      errors: result.errors,
    })
    .returning();

  const now = new Date();
  await db
    .update(s.connectors)
    .set({
      lastSyncedAt: now,
      lastSuccessAt: result.errors.length ? connector.connectors.lastSuccessAt : now,
      lastErrorAt: result.errors.length ? now : connector.connectors.lastErrorAt,
      lastErrorMessage: result.errors[0] ? String(result.errors[0]) : null,
      status: result.errors.length ? "degraded" : "healthy",
      healthMessage: result.errors[0]
        ? String(result.errors[0])
        : config.mock
          ? "Sync OK (demo)"
          : "Sync OK",
      syncCursor: {
        ...(connector.connectors.syncCursor as Record<string, unknown>),
        lastPhase: phase,
        lastSince: since.toISOString(),
      },
      backfillProgressPct: phase === "backfill" ? "100" : connector.connectors.backfillProgressPct,
    })
    .where(eq(s.connectors.id, connector.connectors.id));

  return {
    run,
    result: { ...result, rowsWritten: persisted.written },
    persisted,
    orgId,
  };
}

export { listAdapters, getAdapter };
export { otelSpansToUsageEvents } from "./otel";
export type * from "./types";
