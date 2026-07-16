import type { ConnectorAdapter, NormalizedUsageEvent } from "./types";
import fixture from "./fixtures/cursor.json";

export const cursorAdapter: ConnectorAdapter = {
  providerKey: "cursor",
  tier: 1,
  displayName: "Cursor",
  async authenticate(config) {
    if (!config.apiKey && !config.mock) return { ok: false, message: "Teams Admin API key required" };
    return { ok: true, message: "Authenticated (mock Cursor Teams Admin API)" };
  },
  async discover() {
    return {
      members: (fixture.members as unknown[]).length,
      estimatedMonthlySpend: 180 * 40,
    };
  },
  async backfill() {
    const events: NormalizedUsageEvent[] = [];
    const asOf = new Date(String(fixture.as_of));
    events.push({
      eventTime: asOf,
      providerKey: "cursor",
      skuId: "cursor-teams-seat",
      meterKey: "seats",
      consumedQuantity: Number(fixture.seats_purchased),
      consumedUnit: "Seats",
      tags: { source: "admin_api" },
      serviceName: "Cursor Teams",
      allocationStatus: "allocated",
    });
    for (const m of fixture.members as Array<Record<string, unknown>>) {
      events.push({
        eventTime: asOf,
        providerKey: "cursor",
        skuId: "cursor-premium-request",
        meterKey: "premium_requests",
        consumedQuantity: Number(m.premium_requests ?? 0),
        consumedUnit: "Requests",
        tags: {
          member: String(m.email),
          heavy: String(Boolean(m.heavy)),
          feature: "code_assist",
        },
        serviceName: "Cursor Teams",
        allocationStatus: "allocated",
      });
    }
    return { phase: "backfill", rowsIn: events.length, rowsWritten: events.length, events, errors: [] };
  },
  async incremental(config, since) {
    return this.backfill(config, since);
  },
  async health() {
    return { ok: true, message: "Cursor Teams Admin API reachable (mock)" };
  },
};
