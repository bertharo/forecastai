import type { ConnectorAdapter, NormalizedUsageEvent, SyncResult } from "./types";
import fixture from "./fixtures/anthropic.json";

function toEvents(since: Date): NormalizedUsageEvent[] {
  return (fixture.usage as Array<Record<string, unknown>>)
    .filter((r) => new Date(String(r.timestamp)) >= since)
    .flatMap((r) => {
      const base = {
        eventTime: new Date(String(r.timestamp)),
        providerKey: "anthropic",
        skuId: String(r.model),
        requestId: String(r.request_id ?? ""),
        tags: {
          workspace: String(r.workspace ?? "default"),
          api_key: String(r.api_key_id ?? "key_demo"),
          feature: String(r.feature ?? "unallocated"),
        },
        serviceName: "Claude API",
        allocationStatus:
          r.feature && r.feature !== "unallocated"
            ? ("allocated" as const)
            : ("unallocated" as const),
      };
      return [
        {
          ...base,
          meterKey: "input_tokens",
          consumedQuantity: Number(r.input_tokens),
          consumedUnit: "Tokens",
        },
        {
          ...base,
          meterKey: "output_tokens",
          consumedQuantity: Number(r.output_tokens),
          consumedUnit: "Tokens",
        },
      ];
    });
}

export const anthropicAdapter: ConnectorAdapter = {
  providerKey: "anthropic",
  tier: 1,
  displayName: "Anthropic",
  async authenticate(config) {
    if (!config.apiKey && !config.mock) {
      return { ok: false, message: "API key required" };
    }
    return { ok: true, message: "Authenticated (mock Admin/Usage API)" };
  },
  async discover() {
    return {
      workspaces: fixture.workspaces as string[],
      estimatedMonthlySpend: 32000,
    };
  },
  async backfill(config, since) {
    const events = toEvents(since);
    return {
      phase: "backfill",
      rowsIn: events.length,
      rowsWritten: events.length,
      events,
      errors: [],
    } satisfies SyncResult;
  },
  async incremental(config, since) {
    const events = toEvents(since);
    return {
      phase: "incremental",
      rowsIn: events.length,
      rowsWritten: events.length,
      events,
      errors: [],
    };
  },
  async health() {
    return { ok: true, message: "Anthropic Usage & Cost API reachable (mock)" };
  },
};
