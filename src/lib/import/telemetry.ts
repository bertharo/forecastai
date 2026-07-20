/**
 * Helpers for telemetry-style spend CSVs and flexible CSV header lookup.
 */
import type { RawRow } from "@/lib/import/parse";

/** Case-insensitive + normalized header match into a row. */
export function rowValue(row: RawRow, source: string | undefined): string {
  if (!source) return "";
  if (source.startsWith("_literal:")) return source.slice("_literal:".length);
  if (Object.prototype.hasOwnProperty.call(row, source) && row[source] !== "") {
    return String(row[source]).trim();
  }
  const want = normalizeHeaderKey(source);
  for (const [k, v] of Object.entries(row)) {
    if (normalizeHeaderKey(k) === want) return String(v ?? "").trim();
  }
  return "";
}

export function normalizeHeaderKey(h: string): string {
  return h
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_");
}

/**
 * Parse timestamps including month-only telemetry (YYYY-MM, MM/YYYY).
 * Returns { start, end, monthGrain }.
 */
export function parseImportTimestamp(raw: string): {
  start: Date;
  end: Date;
  monthGrain: boolean;
} | null {
  const t = raw.trim();
  if (!t) return null;

  let m = /^(\d{4})-(\d{2})$/.exec(t);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const start = new Date(Date.UTC(y, mo, 1, 12, 0, 0));
    const end = new Date(Date.UTC(y, mo + 1, 1, 0, 0, 0));
    return { start, end, monthGrain: true };
  }

  m = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const mo = Number(m[1]) - 1;
    const y = Number(m[2]);
    const start = new Date(Date.UTC(y, mo, 1, 12, 0, 0));
    const end = new Date(Date.UTC(y, mo + 1, 1, 0, 0, 0));
    return { start, end, monthGrain: true };
  }

  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) {
    const start = new Date(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
    );
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start);
    end.setUTCHours(end.getUTCHours() + 1);
    return { start, end, monthGrain: false };
  }

  const start = new Date(t);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCHours(end.getUTCHours() + 1);
  return { start, end, monthGrain: false };
}

/** Map ai_tool / vendor labels → Meter provider keys. */
export function resolveProviderKey(raw: string): string {
  const x = raw.trim().toLowerCase();
  if (!x) return "";
  if (["anthropic", "openai", "cursor", "google", "aws_bedrock", "azure_openai"].includes(x)) {
    return x;
  }
  if (x.includes("cursor")) return "cursor";
  if (x.includes("claude") || x.includes("anthropic")) return "anthropic";
  if (
    x.includes("openai") ||
    x.includes("chatgpt") ||
    x.includes("gpt") ||
    x.includes("codex")
  ) {
    return "openai";
  }
  if (x.includes("copilot") || x.includes("github")) return "openai";
  if (x.includes("gemini") || x.includes("google") || x.includes("vertex")) {
    return "google";
  }
  if (x.includes("bedrock") || x.includes("amazon")) return "aws_bedrock";
  if (x.includes("azure")) return "azure_openai";
  // Unknown tool label — keep raw lowercased; caller may still fail on unknown provider
  return x.replace(/\s+/g, "_");
}

export const TELEMETRY_TEMPLATE = {
  name: "AI telemetry (email × month × tool)",
  sourceFormat: "telemetry_monthly",
  columnMap: {
    timestamp: "month",
    provider: "ai_tool",
    model: "model",
    meter: "_literal:input_tokens",
    quantity: "total_tokens",
    cost: "total_spend_dollars",
    "tags.email": "email",
    "tags.ai_tool": "ai_tool",
  } as Record<string, string>,
  sampleHeaders: [
    "email",
    "month",
    "ai_tool",
    "model",
    "total_tokens",
    "total_spend_dollars",
  ],
};

export function looksLikeTelemetryHeaders(headers: string[]): boolean {
  const lower = new Set(headers.map(normalizeHeaderKey));
  const hasEmail = lower.has("email") || lower.has("user_email") || lower.has("work_email");
  const hasMonth = lower.has("month") || lower.has("period") || lower.has("usage_month");
  const hasTool = lower.has("ai_tool") || lower.has("tool") || lower.has("product");
  const hasSpend =
    lower.has("total_spend_dollars") ||
    lower.has("total_sepnd_dollars") || // common typo
    lower.has("total_spend") ||
    lower.has("spend_dollars") ||
    lower.has("spend");
  const hasTokens = lower.has("total_tokens") || lower.has("tokens");
  return hasEmail && hasMonth && hasTool && (hasSpend || hasTokens);
}
