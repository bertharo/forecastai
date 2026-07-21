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
    // spaces, hyphens, en/em dashes, underscores → single _
    .replace(/[\s\-_–—−]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Parse timestamps including month-only telemetry (YYYY-MM, MM/YYYY, "June 2026").
 * Month-grain dating:
 * - completed months → last day of month (stays in trailing-30d into the next month)
 * - current month → today (so mid-month uploads are visible immediately)
 * - future months → first of that month
 */
export function parseImportTimestamp(raw: string): {
  start: Date;
  end: Date;
  monthGrain: boolean;
} | null {
  const t = raw.trim();
  if (!t) return null;

  const monthGrainDates = (y: number, mo0: number) => {
    const monthStart = new Date(Date.UTC(y, mo0, 1, 12, 0, 0));
    const monthLast = new Date(Date.UTC(y, mo0 + 1, 0, 12, 0, 0));
    const monthEndExcl = new Date(Date.UTC(y, mo0 + 1, 1, 0, 0, 0));
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0)
    );
    let start: Date;
    if (monthLast.getTime() <= today.getTime()) {
      start = monthLast;
    } else if (monthStart.getTime() > today.getTime()) {
      start = monthStart;
    } else {
      start = today;
    }
    return { start, end: monthEndExcl, monthGrain: true as const };
  };

  let m = /^(\d{4})-(\d{2})$/.exec(t);
  if (m) return monthGrainDates(Number(m[1]), Number(m[2]) - 1);

  m = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return monthGrainDates(Number(m[2]), Number(m[1]) - 1);

  m =
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})$/i.exec(
      t
    );
  if (m) {
    const names = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const idx = names.findIndex((n) => m![1].toLowerCase().startsWith(n));
    if (idx >= 0) return monthGrainDates(Number(m[2]), idx);
  }

  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) {
    const y = Number(m[1]);
    const mo0 = Number(m[2]) - 1;
    const day = Number(m[3]);
    // Excel often turns month labels (2026-06) into the 1st (or last) of month.
    // Treat those as month-grain so Brief trailing windows stay correct.
    const lastDay = new Date(Date.UTC(y, mo0 + 1, 0)).getUTCDate();
    if (day === 1 || day === lastDay) {
      return monthGrainDates(y, mo0);
    }
    const start = new Date(Date.UTC(y, mo0, day, 12, 0, 0));
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
  if (
    [
      "anthropic",
      "openai",
      "cursor",
      "google",
      "aws_bedrock",
      "azure_openai",
      "perplexity",
      "replit",
      "lovable",
    ].includes(x)
  ) {
    return x;
  }
  if (x.includes("cursor")) return "cursor";
  if (x.includes("claude") || x.includes("anthropic")) return "anthropic";
  // Copilot before generic "gpt" so model names on Copilot rows stay on openai meters
  // but the tool is still distinct via tags.ai_tool for FinOps by-vendor.
  if (x.includes("copilot") || x.includes("github copilot")) return "openai";
  if (
    x.includes("openai") ||
    x.includes("chatgpt") ||
    x.includes("codex") ||
    x === "gpt" ||
    x.startsWith("gpt-") ||
    x.startsWith("gpt_") ||
    /\bgpt\b/.test(x)
  ) {
    return "openai";
  }
  // Bare "github" without Copilot is ambiguous — keep on openai meters for FinOps.
  if (x.includes("github")) return "openai";
  if (x.includes("gemini") || x.includes("google") || x.includes("vertex")) {
    return "google";
  }
  if (x.includes("bedrock") || x.includes("amazon")) return "aws_bedrock";
  if (x.includes("azure")) return "azure_openai";
  if (x.includes("perplexity") || x.includes("pplx")) return "perplexity";
  if (x.includes("replit")) return "replit";
  if (x.includes("lovable")) return "lovable";
  // Unknown tool label — keep raw lowercased; caller may still fail on unknown provider
  return x.replace(/\s+/g, "_");
}

/**
 * Map ai_tool labels → AI Cost tool keys (ai_tool_daily.tool_key).
 * Returns null when the label is not a coding tool (so Gemini / Perplexity /
 * generic cloud API invoices stay on FinOps spend only).
 */
export function resolveCodingToolKey(raw: string): string | null {
  const x = raw.trim().toLowerCase().replace(/[\s\-]+/g, "_");
  if (!x) return null;
  if (x === "claude_code" || x.includes("claude") || x.includes("anthropic")) {
    return "claude_code";
  }
  if (x.includes("cursor")) return "cursor";
  if (x.includes("copilot")) return "copilot";
  if (x.includes("codex")) return "codex";
  if (
    x.includes("chatgpt") ||
    x === "chat_gpt" ||
    x === "openai" ||
    x === "gpt" ||
    x.startsWith("gpt_")
  ) {
    return "chatgpt";
  }
  // Gemini, Perplexity, Bedrock, etc. → FinOps only
  return null;
}

/** True when a coding-tool key should appear on AI Cost (Claude/Cursor/Copilot/ChatGPT/Codex). */
export function isCodingToolLabel(raw: string): boolean {
  return resolveCodingToolKey(raw) != null;
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
