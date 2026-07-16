import type { NormalizedUsageEvent } from "./types";

/**
 * Parse OTel GenAI semantic convention spans into NormalizedUsageEvent.
 * Attributes: gen_ai.system, gen_ai.request.model, gen_ai.response.model,
 * gen_ai.usage.input_tokens, gen_ai.usage.output_tokens
 */
export interface OtelSpan {
  name?: string;
  startTimeUnixNano?: string | number;
  attributes?: Record<string, unknown> | Array<{ key: string; value: Record<string, unknown> }>;
  // simplified form
  "gen_ai.system"?: string;
  "gen_ai.request.model"?: string;
  "gen_ai.response.model"?: string;
  "gen_ai.usage.input_tokens"?: number;
  "gen_ai.usage.output_tokens"?: number;
  tags?: Record<string, string>;
}

function attrsOf(span: OtelSpan): Record<string, unknown> {
  if (span.attributes && !Array.isArray(span.attributes)) {
    return span.attributes;
  }
  if (Array.isArray(span.attributes)) {
    const out: Record<string, unknown> = {};
    for (const a of span.attributes) {
      const v = a.value;
      out[a.key] =
        v?.stringValue ?? v?.intValue ?? v?.doubleValue ?? v?.boolValue ?? v;
    }
    return out;
  }
  return {
    "gen_ai.system": span["gen_ai.system"],
    "gen_ai.request.model": span["gen_ai.request.model"],
    "gen_ai.response.model": span["gen_ai.response.model"],
    "gen_ai.usage.input_tokens": span["gen_ai.usage.input_tokens"],
    "gen_ai.usage.output_tokens": span["gen_ai.usage.output_tokens"],
  };
}

function providerFromSystem(system: string): string {
  const s = system.toLowerCase();
  if (s.includes("anthropic") || s.includes("claude")) return "anthropic";
  if (s.includes("openai") || s.includes("gpt")) return "openai";
  if (s.includes("google") || s.includes("gemini") || s.includes("vertex")) return "google";
  return s || "unknown";
}

export function otelSpansToUsageEvents(spans: OtelSpan[]): NormalizedUsageEvent[] {
  const events: NormalizedUsageEvent[] = [];
  for (const span of spans) {
    const a = attrsOf(span);
    const system = String(a["gen_ai.system"] ?? "unknown");
    const model = String(
      a["gen_ai.response.model"] ?? a["gen_ai.request.model"] ?? "unknown"
    );
    const inputTokens = Number(a["gen_ai.usage.input_tokens"] ?? 0);
    const outputTokens = Number(a["gen_ai.usage.output_tokens"] ?? 0);
    const providerKey = providerFromSystem(system);
    const eventTime = span.startTimeUnixNano
      ? new Date(Number(span.startTimeUnixNano) / 1e6)
      : new Date();
    const tags: Record<string, string> = {
      ...(span.tags ?? {}),
      source: "otel",
      gen_ai_system: system,
    };
    // map common OTel resource attrs if present
    for (const key of ["team", "feature", "environment", "customer_id", "project"]) {
      if (a[key] != null) tags[key] = String(a[key]);
      if (a[`meter.${key}`] != null) tags[key] = String(a[`meter.${key}`]);
    }
    const allocated = Boolean(tags.team || tags.feature);

    if (inputTokens > 0) {
      events.push({
        eventTime,
        providerKey,
        skuId: model,
        meterKey: "input_tokens",
        consumedQuantity: inputTokens,
        consumedUnit: "Tokens",
        tags,
        serviceName: `${system} (OTel)`,
        allocationStatus: allocated ? "allocated" : "unallocated",
      });
    }
    if (outputTokens > 0) {
      events.push({
        eventTime,
        providerKey,
        skuId: model,
        meterKey: "output_tokens",
        consumedQuantity: outputTokens,
        consumedUnit: "Tokens",
        tags,
        serviceName: `${system} (OTel)`,
        allocationStatus: allocated ? "allocated" : "unallocated",
      });
    }
  }
  return events;
}
