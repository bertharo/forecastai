import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";

/** Below this, a model's observed rate is too noisy to recommend switching to/from. */
const MIN_SAMPLE_COST_USD = 50;
const MIN_SAMPLE_TOKENS = 50_000;

export type ObservedModelRate = {
  focusSkuId: string;
  totalCost: number;
  totalTokens: number;
  /** $ per 1M tokens, blended input+output (matches the app's other pricing conventions). Null when no token data exists for this model. */
  ratePerMillion: number | null;
  sampleRows: number;
  /** True once cost/token volume clears the noise floor for switch recommendations. */
  reliable: boolean;
};

/**
 * Blended $/1k-token rate per model, computed from this org's own ingested spend
 * (not price-card list prices — most real CSV model strings don't match the
 * canonical price catalog, so a price-card lookup would silently miss them).
 */
export async function getObservedModelRates(
  orgId: string,
  opts: { from: Date; to: Date }
): Promise<ObservedModelRate[]> {
  const rows = await db
    .select({
      focusSkuId: s.costRecords.focusSkuId,
      totalCost: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}), 0)`,
      totalTokens: sql<string>`coalesce(sum(
        coalesce(
          nullif(${s.costRecords.tags}->>'total_tokens', '')::numeric,
          case
            when lower(${s.costRecords.consumedUnit}) = 'tokens'
            then coalesce(${s.costRecords.consumedQuantity}, 0)
            else 0
          end
        )
      ), 0)`,
      sampleRows: sql<string>`count(*)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, opts.from),
        lt(s.costRecords.chargePeriodStart, opts.to),
        sql`${s.costRecords.focusSkuId} is not null and ${s.costRecords.focusSkuId} <> ''`
      )
    )
    .groupBy(s.costRecords.focusSkuId);

  return rows
    .filter((r) => r.focusSkuId)
    .map((r) => {
      const totalCost = Number(r.totalCost);
      const totalTokens = Number(r.totalTokens);
      const ratePerMillion = totalTokens > 0 ? (totalCost / totalTokens) * 1e6 : null;
      return {
        focusSkuId: r.focusSkuId as string,
        totalCost,
        totalTokens,
        ratePerMillion,
        sampleRows: Number(r.sampleRows),
        reliable:
          ratePerMillion != null &&
          (totalCost >= MIN_SAMPLE_COST_USD || totalTokens >= MIN_SAMPLE_TOKENS),
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);
}
