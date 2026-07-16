import { registerAdapter } from "./registry";
import { anthropicAdapter } from "./anthropic";
import { openaiAdapter } from "./openai";
import { cursorAdapter } from "./cursor";
import { stubAdapters } from "./stubs";
import { getAdapter, listAdapters } from "./registry";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";

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
  phase: "backfill" | "incremental" = "incremental"
) {
  ensureRegistry();
  const adapter = getAdapter(providerKey);
  if (!adapter) throw new Error(`Unknown provider: ${providerKey}`);

  const [connector] = await db
    .select()
    .from(s.connectors)
    .innerJoin(s.providers, eq(s.connectors.providerId, s.providers.id))
    .where(eq(s.providers.key, providerKey))
    .limit(1);

  const config = { mock: true, ...(connector?.connectors.authConfig ?? {}) };
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (phase === "backfill" ? 30 : 7));

  const result =
    phase === "backfill"
      ? await adapter.backfill(config, since)
      : await adapter.incremental(config, since);

  if (connector) {
    const [run] = await db
      .insert(s.connectorSyncRuns)
      .values({
        connectorId: connector.connectors.id,
        phase,
        finishedAt: new Date(),
        rowsIn: result.rowsIn,
        rowsWritten: result.rowsWritten,
        errors: result.errors,
      })
      .returning();

    await db
      .update(s.connectors)
      .set({
        lastSyncedAt: new Date(),
        status: result.errors.length ? "degraded" : "healthy",
        healthMessage: result.errors[0] ?? "Sync OK",
      })
      .where(eq(s.connectors.id, connector.connectors.id));

    return { run, result, orgId };
  }

  return { run: null, result, orgId };
}

export { listAdapters, getAdapter };
export { otelSpansToUsageEvents } from "./otel";
export type * from "./types";
