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

type UsageBucket = {
  starting_at?: string;
  ending_at?: string;
  results?: Array<{
    model?: string;
    workspace_id?: string;
    api_key_id?: string;
    input_tokens?: number;
    output_tokens?: number;
  }>;
};

/** Live Anthropic Admin Usage API (Messages Usage report). Falls back to mock when demo/mock. */
async function fetchLiveUsage(
  apiKey: string,
  since: Date
): Promise<NormalizedUsageEvent[]> {
  const start = since.toISOString();
  const end = new Date().toISOString();
  const url = new URL("https://api.anthropic.com/v1/organizations/usage_report/messages");
  url.searchParams.set("starting_at", start);
  url.searchParams.set("ending_at", end);
  url.searchParams.set("bucket_width", "1d");
  url.searchParams.set("group_by[]", "model");

  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic usage API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: UsageBucket[] };
  const events: NormalizedUsageEvent[] = [];
  for (const bucket of data.data ?? []) {
    const eventTime = new Date(bucket.starting_at ?? start);
    for (const r of bucket.results ?? []) {
      const tags = {
        workspace: r.workspace_id ?? "default",
        api_key: r.api_key_id ?? "unknown",
        feature: "unallocated",
        source: "anthropic_admin",
      };
      const base = {
        eventTime,
        providerKey: "anthropic",
        skuId: r.model ?? "unknown",
        tags,
        serviceName: "Claude API",
        allocationStatus: "unallocated" as const,
      };
      if (r.input_tokens) {
        events.push({
          ...base,
          meterKey: "input_tokens",
          consumedQuantity: r.input_tokens,
          consumedUnit: "Tokens",
        });
      }
      if (r.output_tokens) {
        events.push({
          ...base,
          meterKey: "output_tokens",
          consumedQuantity: r.output_tokens,
          consumedUnit: "Tokens",
        });
      }
    }
  }
  return events;
}

function useMock(config: Record<string, unknown>): boolean {
  return Boolean(config.mock || config.demoMode || !config.apiKey);
}

export const anthropicAdapter: ConnectorAdapter = {
  providerKey: "anthropic",
  tier: 1,
  displayName: "Anthropic",
  async authenticate(config) {
    if (useMock(config)) {
      return { ok: true, message: "Authenticated (demo / mock Admin API)" };
    }
    if (!config.apiKey) return { ok: false, message: "Admin API key required" };
    try {
      await fetchLiveUsage(String(config.apiKey), new Date(Date.now() - 86400_000));
      return { ok: true, message: "Authenticated (Anthropic Admin Usage API)" };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Auth failed",
      };
    }
  },
  async discover(config) {
    if (useMock(config)) {
      return {
        workspaces: fixture.workspaces as string[],
        estimatedMonthlySpend: 32000,
      };
    }
    return { workspaces: ["live"], estimatedMonthlySpend: undefined };
  },
  async backfill(config, since) {
    const events = useMock(config)
      ? toEvents(since)
      : await fetchLiveUsage(String(config.apiKey), since);
    return {
      phase: "backfill",
      rowsIn: events.length,
      rowsWritten: events.length,
      events,
      errors: [],
    } satisfies SyncResult;
  },
  async incremental(config, since) {
    const events = useMock(config)
      ? toEvents(since)
      : await fetchLiveUsage(String(config.apiKey), since);
    return {
      phase: "incremental",
      rowsIn: events.length,
      rowsWritten: events.length,
      events,
      errors: [],
    };
  },
  async health(config) {
    if (useMock(config)) {
      return { ok: true, message: "Anthropic Usage & Cost API reachable (mock)" };
    }
    try {
      await fetchLiveUsage(String(config.apiKey), new Date(Date.now() - 86400_000));
      return { ok: true, message: "Anthropic Admin Usage API healthy" };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Unhealthy",
      };
    }
  },
};
