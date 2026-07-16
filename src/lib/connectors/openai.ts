import type { ConnectorAdapter, NormalizedUsageEvent } from "./types";
import fixture from "./fixtures/openai.json";

function toEvents(since: Date): NormalizedUsageEvent[] {
  return (fixture.usage as Array<Record<string, unknown>>)
    .filter((r) => new Date(String(r.timestamp)) >= since)
    .flatMap((r) => {
      const base = {
        eventTime: new Date(String(r.timestamp)),
        providerKey: "openai",
        skuId: String(r.model),
        requestId: String(r.id ?? ""),
        tags: {
          project: String(r.project_id ?? "default"),
          feature: String(r.feature ?? "unallocated"),
        },
        serviceName: "OpenAI API",
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
          consumedQuantity: Number(r.output_tokens ?? 0),
          consumedUnit: "Tokens",
        },
      ];
    });
}

export const openaiAdapter: ConnectorAdapter = {
  providerKey: "openai",
  tier: 1,
  displayName: "OpenAI",
  async authenticate(config) {
    if (!config.apiKey && !config.mock) return { ok: false, message: "API key required" };
    return { ok: true, message: "Authenticated (mock Usage & Costs API)" };
  },
  async discover() {
    return {
      projects: fixture.projects as string[],
      estimatedMonthlySpend: 22000,
    };
  },
  async backfill(_c, since) {
    const events = toEvents(since);
    return { phase: "backfill", rowsIn: events.length, rowsWritten: events.length, events, errors: [] };
  },
  async incremental(_c, since) {
    const events = toEvents(since);
    return { phase: "incremental", rowsIn: events.length, rowsWritten: events.length, events, errors: [] };
  },
  async health() {
    return { ok: true, message: "OpenAI Usage API reachable (mock)" };
  },
};
