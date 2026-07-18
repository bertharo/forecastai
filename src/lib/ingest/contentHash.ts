import { createHash } from "crypto";
import type { NormalizedUsageEvent } from "@/lib/connectors/types";

/**
 * Stable identity for Admin/connector daily grains so re-sync upserts instead of duplicating.
 * OTel request-level events without a requestId are left unhashed (always insert).
 */
export function usageEventContentHash(
  orgId: string,
  ev: NormalizedUsageEvent
): string | null {
  const source = ev.tags?.source ?? "";
  const isAdminGrain =
    source === "anthropic_admin" ||
    source.endsWith("_admin") ||
    source.includes("admin");
  if (!isAdminGrain && !ev.requestId) return null;

  const day = ev.eventTime.toISOString().slice(0, 10);
  const payload = [
    orgId,
    ev.providerKey,
    day,
    ev.skuId ?? "",
    ev.meterKey,
    ev.tags?.api_key ?? "",
    ev.tags?.workspace ?? "",
    source || "unknown",
    ev.requestId ?? "",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}
