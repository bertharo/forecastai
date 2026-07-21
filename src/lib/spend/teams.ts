import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
  enabledDimensionsInOrder,
  ensurePeopleDimensionConfig,
} from "@/lib/roster/dimensions";

export type TeamModelUsage = {
  focusSkuId: string;
  spend: number;
  tokens: number;
};

export type TeamUsage = {
  key: string;
  label: string;
  spend: number;
  tokens: number;
  byModel: TeamModelUsage[];
};

export type RealTeamUsageResult = {
  attrKey: string;
  displayName: string;
  teams: TeamUsage[];
};

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows: T[] }).rows ?? []) as T[];
  }
  return [];
}

/**
 * Real per-team (org's primary enabled people-dimension) spend + per-model
 * breakdown, joined from cost_records -> contributors.attributes — same join
 * pattern as brief.ts's byDimensions rollup, extended to group by model.
 * Returns null when there's no enabled dimension or no attributable spend in
 * the window, so callers can fall back to demo data.
 */
export async function getRealTeamUsage(
  orgId: string,
  opts: { from: Date; to: Date }
): Promise<RealTeamUsageResult | null> {
  const dimConfig = await ensurePeopleDimensionConfig(orgId);
  const enabledDims = enabledDimensionsInOrder(dimConfig);
  const primary = enabledDims[0];
  if (!primary || !/^[a-z0-9_]+$/i.test(primary.key)) return null;

  const attrKey = primary.key;
  const rows = await db.execute(sql`
    with base as (
      select
        cr.effective_cost::numeric as spend,
        cr.focus_sku_id as model,
        coalesce(
          nullif(cr.tags->>'total_tokens', '')::numeric,
          case
            when lower(cr.consumed_unit) = 'tokens'
            then coalesce(cr.consumed_quantity, 0)
            else 0
          end
        ) as tokens,
        lower(trim(coalesce(cr.tags->>'email', cr.tags->>'user_email', ''))) as email
      from cost_records cr
      where cr.org_id = ${orgId}::uuid
        and cr.charge_period_start >= ${opts.from.toISOString()}::timestamptz
        and cr.charge_period_start < ${opts.to.toISOString()}::timestamptz
        and cr.focus_sku_id is not null and cr.focus_sku_id <> ''
    ),
    joined as (
      select
        b.spend,
        b.model,
        b.tokens,
        trim(c.attributes->>${attrKey}) as label
      from base b
      join contributors c
        on c.org_id = ${orgId}::uuid
        and c.email = b.email
        and b.email <> ''
      where c.id is not null
        and nullif(trim(c.attributes->>${attrKey}), '') is not null
    )
    select
      label,
      model,
      coalesce(sum(spend), 0)::text as spend,
      coalesce(sum(tokens), 0)::text as tokens
    from joined
    group by label, model
    order by label, sum(spend) desc
  `);

  const raw = asRows<{
    label: string;
    model: string;
    spend: string;
    tokens: string;
  }>(rows);

  const byTeam = new Map<string, TeamUsage>();
  for (const r of raw) {
    const spend = Number(r.spend);
    const tokens = Number(r.tokens);
    let team = byTeam.get(r.label);
    if (!team) {
      team = { key: r.label, label: r.label, spend: 0, tokens: 0, byModel: [] };
      byTeam.set(r.label, team);
    }
    team.spend += spend;
    team.tokens += tokens;
    team.byModel.push({ focusSkuId: r.model, spend, tokens });
  }

  const teams = [...byTeam.values()]
    .map((t) => ({ ...t, byModel: t.byModel.sort((a, b) => b.spend - a.spend) }))
    .sort((a, b) => b.spend - a.spend);

  if (teams.length === 0) return null;

  return { attrKey, displayName: primary.displayName, teams };
}
