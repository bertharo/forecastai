import type { ConnectorAdapter } from "./types";

/**
 * Stub adapters — contracts only. Tier upgrades (4→1) must not require schema changes.
 *
 * TODO: aws_cur — map AWS CUR columns → FOCUS:
 *   lineItem/UsageStartDate → ChargePeriodStart
 *   lineItem/UnblendedCost → BilledCost
 *   lineItem/UsageAmount → ConsumedQuantity
 *   product/ProductName → ServiceName
 *   lineItem/UsageType + product/sku → SkuId
 *   resourceTags → dimension mapping via allocation_rules
 *
 * TODO: azure_cost_export — Cost Management export → same FOCUS fields
 * TODO: gcp_billing_export — BigQuery billing export → same FOCUS fields
 */

function stub(
  providerKey: string,
  tier: 1 | 2 | 3 | 4,
  displayName: string,
  todo: string
): ConnectorAdapter {
  return {
    providerKey,
    tier,
    displayName,
    async authenticate() {
      return { ok: false, message: `Stub: ${todo}` };
    },
    async discover() {
      return {};
    },
    async backfill() {
      return {
        phase: "backfill",
        rowsIn: 0,
        rowsWritten: 0,
        events: [],
        errors: [`TODO: ${todo}`],
      };
    },
    async incremental() {
      return {
        phase: "incremental",
        rowsIn: 0,
        rowsWritten: 0,
        events: [],
        errors: [`TODO: ${todo}`],
      };
    },
    async health() {
      return { ok: false, message: `Not implemented — ${todo}` };
    },
  };
}

export const stubAdapters: ConnectorAdapter[] = [
  stub(
    "google",
    2,
    "Google Gemini",
    "Vertex AI via GCP billing export (BigQuery); AI Studio via usage CSV + mapping_templates"
  ),
  stub("perplexity", 4, "Perplexity", "API usage via key (tier1 path) + Enterprise seats via invoice reconciliation"),
  stub("replit", 4, "Replit", "Credits model; invoice/CSV reconciliation until admin API exists"),
  stub("lovable", 4, "Lovable", "Credits model; invoice reconciliation"),
  stub(
    "aws_cur",
    2,
    "AWS CUR",
    "Map CUR → FOCUS UsageEvent/CostRecord; same adapter path as Bedrock today"
  ),
  stub(
    "azure_cost_export",
    2,
    "Azure Cost Management",
    "Map Cost Management export → FOCUS; covers Azure OpenAI + full subscription spend later"
  ),
  stub(
    "gcp_billing_export",
    2,
    "GCP Billing Export",
    "Map BigQuery billing export → FOCUS; covers Vertex + full GCP later"
  ),
];
