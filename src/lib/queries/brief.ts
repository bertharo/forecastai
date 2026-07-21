/**
 * Brief page fact set — one period, one classification, one object.
 * Every Brief card must render slices of getBriefFacts(); no parallel windows.
 */
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { countUnmappedKeys } from "@/lib/keys/registry";
import {
  enabledDimensionsInOrder,
  ensurePeopleDimensionConfig,
} from "@/lib/roster/dimensions";
import {
  periodForGrain,
  resolveDashboardPeriod,
  rollingPeriod,
  type DashboardPeriod,
  type SpendGrain,
} from "@/lib/queries/period";

const MONEY_EPS = 0.02;

export type BriefPeriod = DashboardPeriod;

export type BriefAttribution = {
  totalSpend: number;
  /** email_join + key_registry */
  attributedSpend: number;
  attributedPct: number;
  /** Spend whose email matched a roster person */
  emailJoinSpend: number;
  /** Spend attributed only via key → team mapping (no roster email match) */
  keyRegistrySpend: number;
  /** Remainder — partitions total with the two attributed buckets */
  unallocatedSpend: number;
};

export type BriefVendorRow = { key: string; name: string; spend: number };

export type BriefDimensionValueRow = {
  label: string;
  spend: number;
  source: "roster" | "key_registry" | "unallocated";
};

/** One Home card per enabled people-CSV dimension */
export type BriefDimensionRollup = {
  key: string;
  sourceColumn: string;
  displayName: string;
  role: "primary" | "secondary" | null;
  rows: BriefDimensionValueRow[];
};

export type BriefFinding = {
  id: "terminated_seats" | "inactive_seats" | "unmapped_keys";
  title: string;
  severity: "high" | "medium" | "low";
  count: number;
  /** Spend (or monthly seat $) for the Brief period where applicable */
  impact: number;
  detail: string;
  href: string;
  /** For unmapped_keys: impact is a labeled subset of unallocated when true */
  impactIsSubsetOfUnallocated?: boolean;
};

export type BriefInvariantViolation = {
  id: string;
  message: string;
  expected?: number;
  actual?: number;
};

export type BriefFacts = {
  orgId: string;
  period: BriefPeriod;
  totalSpend: number;
  /**
   * Sum of all cost_records (no date window). For spreadsheet imports this is
   * the number that must match sum(total_spend_dollars) on the sheet.
   */
  allTimeSpend: number;
  byVendor: BriefVendorRow[];
  /** Config-driven people attribute rollups (primary first) */
  byDimensions: BriefDimensionRollup[];
  /** True when people exist but no dimensions are enabled */
  needsDimensionConfig: boolean;
  /**
   * True when the labeled period has no cost rows but all-time spend exists.
   * UI must show an empty state — never a total from outside the label.
   */
  periodEmpty: boolean;
  attribution: BriefAttribution;
  findings: BriefFinding[];
  unmappedKeyCount: number;
  /** Distinct UTC days with cost rows (any time), for forecast eligibility */
  historyDays: number;
  hasUserPlan: boolean;
  planName: string | null;
  planAnnualAmount: number | null;
  sampleDataLoadedAt: Date | null;
  hasUserImports: boolean;
  dataMixed: boolean;
  empty: boolean;
  violations: BriefInvariantViolation[];
};

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows: T[] }).rows ?? []) as T[];
  }
  return [];
}

/** @deprecated Prefer resolveBriefPeriod — rolling day window only. */
export function trailingBriefPeriod(days = 30, now = new Date()): BriefPeriod {
  return rollingPeriod(days, now);
}

/** Grain-aware Brief period (calendar months when spend is monthly). */
export async function resolveBriefPeriod(
  orgId: string,
  days = 30,
  now = new Date()
): Promise<BriefPeriod> {
  return resolveDashboardPeriod(orgId, days, now);
}

export function briefPeriodForGrain(
  grain: SpendGrain,
  days = 30,
  now = new Date()
): BriefPeriod {
  return periodForGrain(grain, days, now);
}

function nearlyEqual(a: number, b: number, eps = MONEY_EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export async function workspaceHasUserImports(orgId: string): Promise<boolean> {
  const [batches] = await db
    .select({ n: sql<string>`count(*)` })
    .from(s.importBatches)
    .where(eq(s.importBatches.orgId, orgId));
  if (Number(batches?.n ?? 0) > 0) return true;

  const nonSeed = await db.execute(sql`
    select count(*)::int as n
    from cost_records
    where org_id = ${orgId}::uuid
      and coalesce(tags->>'source', '') <> 'seed'
  `);
  const row = asRows<{ n: number }>(nonSeed)[0];
  return Number(row?.n ?? 0) > 0;
}

export function checkBriefInvariants(facts: BriefFacts): BriefInvariantViolation[] {
  const v: BriefInvariantViolation[] = [];
  const { attribution: a, totalSpend, byVendor, byDimensions } = facts;

  const vendorSum = byVendor.reduce((s, r) => s + r.spend, 0);
  if (!nearlyEqual(vendorSum, totalSpend)) {
    v.push({
      id: "vendor_sum",
      message: `sum(by_vendor) ≠ total`,
      expected: totalSpend,
      actual: vendorSum,
    });
  }

  for (const dim of byDimensions) {
    const dimSum = dim.rows.reduce((s, r) => s + r.spend, 0);
    if (!nearlyEqual(dimSum, totalSpend)) {
      v.push({
        id: `dim_sum_${dim.key}`,
        message: `sum(by_dimension:${dim.key}) ≠ total`,
        expected: totalSpend,
        actual: dimSum,
      });
    }
  }

  if (!nearlyEqual(a.emailJoinSpend + a.keyRegistrySpend, a.attributedSpend)) {
    v.push({
      id: "attr_components",
      message: `email_join + key_registry ≠ attributed`,
      expected: a.attributedSpend,
      actual: a.emailJoinSpend + a.keyRegistrySpend,
    });
  }

  if (!nearlyEqual(a.attributedSpend + a.unallocatedSpend, totalSpend)) {
    v.push({
      id: "attr_partition",
      message: `attributed + unallocated ≠ total`,
      expected: totalSpend,
      actual: a.attributedSpend + a.unallocatedSpend,
    });
  }

  const unmapped = facts.findings.find((f) => f.id === "unmapped_keys");
  if (unmapped) {
    if (unmapped.impact > a.unallocatedSpend + MONEY_EPS) {
      v.push({
        id: "unmapped_vs_unallocated",
        message: `findings.unmapped_keys.spend exceeds unallocated$ for period`,
        expected: a.unallocatedSpend,
        actual: unmapped.impact,
      });
    }
    if (unmapped.count !== facts.unmappedKeyCount) {
      v.push({
        id: "unmapped_count",
        message: `findings unmapped count ≠ registry unmapped count`,
        expected: facts.unmappedKeyCount,
        actual: unmapped.count,
      });
    }
  }

  if (!nearlyEqual(a.totalSpend, totalSpend)) {
    v.push({
      id: "attr_total",
      message: `attribution.total ≠ total`,
      expected: totalSpend,
      actual: a.totalSpend,
    });
  }

  return v;
}

/**
 * Single fact set for the Brief page. All spend slices share `period`.
 * When `period` is omitted, resolves a grain-aware window for the org.
 */
export async function getBriefFacts(
  orgId: string,
  period?: BriefPeriod
): Promise<BriefFacts> {
  const resolvedPeriod = period ?? (await resolveBriefPeriod(orgId, 30));
  const startIso = resolvedPeriod.start.toISOString();
  const endIso = resolvedPeriod.end.toISOString();

  const dimConfig = await ensurePeopleDimensionConfig(orgId);
  const enabledDims = enabledDimensionsInOrder(dimConfig);
  const needsDimensionConfig =
    enabledDims.length === 0 &&
    (dimConfig.rowCount > 0 || dimConfig.columns.length > 0);

  const classified = await db.execute(sql`
    with base as (
      select
        cr.effective_cost::numeric as spend,
        cr.provider_id,
        lower(trim(coalesce(cr.tags->>'email', cr.tags->>'user_email', ''))) as email,
        coalesce(nullif(trim(cr.tags->>'api_key'), ''), nullif(trim(cr.tags->>'apiKey'), ''), '') as api_key,
        coalesce(cr.tags->>'seat_status', '') as seat_status
      from cost_records cr
      where cr.org_id = ${orgId}::uuid
        and cr.charge_period_start >= ${startIso}::timestamptz
        and cr.charge_period_start < ${endIso}::timestamptz
    ),
    joined as (
      select
        b.spend,
        b.provider_id,
        b.email,
        b.api_key,
        b.seat_status,
        c.id as contributor_id,
        c.employment_status,
        pkr.id as registry_id,
        pkr.dimension_node_id as key_node_id,
        n.display_name as key_team_name,
        (c.id is not null) as email_joined,
        (c.id is null and pkr.dimension_node_id is not null) as key_attributed,
        (c.id is null and (pkr.id is null or pkr.dimension_node_id is null)) as is_unallocated,
        (c.id is null and pkr.id is not null and pkr.dimension_node_id is null) as unmapped_key_spend
      from base b
      left join contributors c
        on c.org_id = ${orgId}::uuid
        and c.email = b.email
        and b.email <> ''
      left join provider_key_registry pkr
        on pkr.org_id = ${orgId}::uuid
        and pkr.kind = 'api_key'
        and pkr.external_id = b.api_key
        and b.api_key <> ''
      left join dimension_nodes n on n.id = pkr.dimension_node_id
    )
    select
      coalesce(sum(spend), 0)::text as total_spend,
      coalesce(sum(spend) filter (where email_joined), 0)::text as email_join_spend,
      coalesce(sum(spend) filter (where key_attributed), 0)::text as key_registry_spend,
      coalesce(sum(spend) filter (where is_unallocated), 0)::text as unallocated_spend,
      coalesce(sum(spend) filter (where unmapped_key_spend), 0)::text as unmapped_key_spend
    from joined
  `);

  const [totals] = asRows<{
    total_spend: string;
    email_join_spend: string;
    key_registry_spend: string;
    unallocated_spend: string;
    unmapped_key_spend: string;
  }>(classified);

  const totalSpend = Number(totals?.total_spend ?? 0);
  const emailJoinSpend = Number(totals?.email_join_spend ?? 0);
  const keyRegistrySpend = Number(totals?.key_registry_spend ?? 0);
  const unallocatedSpend = Number(totals?.unallocated_spend ?? 0);
  const unmappedKeySpend = Number(totals?.unmapped_key_spend ?? 0);
  const attributedSpend = emailJoinSpend + keyRegistrySpend;

  // Prefer tags.ai_tool so telemetry rows keep sheet labels (ChatGPT Enterprise,
  // GitHub Copilot, Gemini, …) instead of collapsing Copilot+ChatGPT → OpenAI.
  const vendorRows = await db.execute(sql`
    select
      coalesce(
        nullif(lower(trim(cr.tags->>'ai_tool')), ''),
        p.key
      ) as key,
      min(
        coalesce(
          nullif(trim(cr.tags->>'ai_tool'), ''),
          p.display_name
        )
      ) as name,
      coalesce(sum(cr.effective_cost), 0)::text as spend
    from cost_records cr
    inner join providers p on p.id = cr.provider_id
    where cr.org_id = ${orgId}::uuid
      and cr.charge_period_start >= ${startIso}::timestamptz
      and cr.charge_period_start < ${endIso}::timestamptz
    group by 1
    order by sum(cr.effective_cost) desc
  `);

  const byVendor = asRows<{ key: string; name: string; spend: string }>(vendorRows).map(
    (r) => ({
      key: r.key,
      name: r.name,
      spend: Number(r.spend),
    })
  );

  const allTimeRows = await db.execute(sql`
    select coalesce(sum(effective_cost), 0)::text as spend
    from cost_records
    where org_id = ${orgId}::uuid
  `);
  const allTimeSpend = Number(asRows<{ spend: string }>(allTimeRows)[0]?.spend ?? 0);

  const periodEmpty = totalSpend < 0.01 && allTimeSpend > 0.01;

  // Config-driven attribute rollups — one query per enabled dimension
  const byDimensions: BriefDimensionRollup[] = [];
  for (const dim of enabledDims) {
    // Validate key: only alphanumeric + underscore (normalized header keys)
    if (!/^[a-z0-9_]+$/i.test(dim.key)) continue;
    const attrKey = dim.key;
    const dimRows = await db.execute(sql`
      with base as (
        select
          cr.effective_cost::numeric as spend,
          lower(trim(coalesce(cr.tags->>'email', cr.tags->>'user_email', ''))) as email,
          coalesce(nullif(trim(cr.tags->>'api_key'), ''), nullif(trim(cr.tags->>'apiKey'), ''), '') as api_key
        from cost_records cr
        where cr.org_id = ${orgId}::uuid
          and cr.charge_period_start >= ${startIso}::timestamptz
          and cr.charge_period_start < ${endIso}::timestamptz
      ),
      joined as (
        select
          b.spend,
          case
            when c.id is not null and nullif(trim(c.attributes->>${attrKey}), '') is not null
              then trim(c.attributes->>${attrKey})
            when c.id is null and n.display_name is not null then n.display_name
            else 'Unallocated'
          end as label,
          case
            when c.id is not null and nullif(trim(c.attributes->>${attrKey}), '') is not null
              then 'roster'
            when c.id is null and pkr.dimension_node_id is not null then 'key_registry'
            else 'unallocated'
          end as source
        from base b
        left join contributors c
          on c.org_id = ${orgId}::uuid
          and c.email = b.email
          and b.email <> ''
        left join provider_key_registry pkr
          on pkr.org_id = ${orgId}::uuid
          and pkr.kind = 'api_key'
          and pkr.external_id = b.api_key
          and b.api_key <> ''
          and c.id is null
        left join dimension_nodes n on n.id = pkr.dimension_node_id
      )
      select
        label,
        source,
        coalesce(sum(spend), 0)::text as spend
      from joined
      group by label, source
      order by sum(spend) desc
    `);

    byDimensions.push({
      key: dim.key,
      sourceColumn: dim.sourceColumn,
      displayName: dim.displayName,
      role: dim.role,
      rows: asRows<{ label: string; source: string; spend: string }>(dimRows).map(
        (r) => ({
          label: r.label,
          spend: Number(r.spend),
          source: r.source as BriefDimensionValueRow["source"],
        })
      ),
    });
  }

  // Findings — terminated seats use same period window
  const terminated = await db.execute(sql`
    select
      c.email,
      coalesce(sum(cr.effective_cost), 0)::text as spend
    from contributors c
    inner join cost_records cr
      on cr.org_id = c.org_id
      and lower(trim(coalesce(cr.tags->>'email', ''))) = c.email
      and cr.tags->>'seat_status' = 'terminated_active'
      and cr.charge_period_start >= ${startIso}::timestamptz
      and cr.charge_period_start < ${endIso}::timestamptz
    where c.org_id = ${orgId}::uuid
      and (
        c.employment_status = 'terminated'
        or (c.ended_on is not null and c.ended_on < current_date)
      )
    group by c.email
  `);
  const termRows = asRows<{ email: string; spend: string }>(terminated);
  const termImpact = termRows.reduce((a, r) => a + Number(r.spend), 0);

  const [snap] = await db
    .select()
    .from(s.seatSnapshots)
    .where(eq(s.seatSnapshots.orgId, orgId))
    .orderBy(desc(s.seatSnapshots.asOf))
    .limit(1);
  const meta = (snap?.metadata ?? {}) as {
    inactive?: number;
    seatPrice?: number;
    inactiveEmails?: string[];
  };
  const inactiveCount =
    meta.inactive ??
    (Array.isArray(meta.inactiveEmails) ? meta.inactiveEmails.length : 0);
  const seatPrice = meta.seatPrice ?? 200;

  const unmappedKeyCount = await countUnmappedKeys(orgId);

  const findings: BriefFinding[] = [];
  if (termRows.length > 0) {
    findings.push({
      id: "terminated_seats",
      title: "Terminated employees with active seats",
      severity: "high",
      count: termRows.length,
      impact: termImpact,
      detail: `${termRows.length} people still billed for seats after end date · ${usdPlain(termImpact)} in period`,
      href: "/import#roster",
    });
  }
  if (inactiveCount > 0) {
    findings.push({
      id: "inactive_seats",
      title: "Inactive seats (30+ days)",
      severity: "medium",
      count: inactiveCount,
      impact: inactiveCount * seatPrice,
      detail: `${inactiveCount} seats unused 30+ days · ~${usdPlain(inactiveCount * seatPrice)}/mo`,
      href: "/connectors",
    });
  }
  if (unmappedKeyCount > 0) {
    findings.push({
      id: "unmapped_keys",
      title: "Unmapped API keys",
      severity: "high",
      count: unmappedKeyCount,
      impact: unmappedKeySpend,
      impactIsSubsetOfUnallocated: true,
      detail: `${unmappedKeyCount} keys with ${usdPlain(unmappedKeySpend)} unallocated spend in period — assign a team`,
      href: "/keys?unmapped=1",
    });
  }

  const hist = await db.execute(sql`
    select count(distinct (charge_period_start at time zone 'UTC')::date)::int as n
    from cost_records
    where org_id = ${orgId}::uuid
  `);
  const historyDays = Number(asRows<{ n: number }>(hist)[0]?.n ?? 0);

  const [budget] = await db
    .select()
    .from(s.budgets)
    .where(and(eq(s.budgets.orgId, orgId), eq(s.budgets.scopeType, "org")))
    .limit(1);

  let planAnnualAmount: number | null = null;
  if (budget) {
    const amt = Number(budget.amount);
    planAnnualAmount =
      budget.period === "annual"
        ? amt
        : budget.period === "quarterly"
          ? amt * 4
          : amt * 12;
  }

  const [orgRow] = await db
    .select({ at: s.organizations.sampleDataLoadedAt })
    .from(s.organizations)
    .where(eq(s.organizations.id, orgId))
    .limit(1);

  const sampleDataLoadedAt = orgRow?.at ?? null;
  const hasUserImports = await workspaceHasUserImports(orgId);
  const dataMixed = Boolean(sampleDataLoadedAt) && hasUserImports;

  const attribution: BriefAttribution = {
    totalSpend,
    attributedSpend,
    attributedPct: totalSpend > 0 ? attributedSpend / totalSpend : 1,
    emailJoinSpend,
    keyRegistrySpend,
    unallocatedSpend,
  };

  const facts: BriefFacts = {
    orgId,
    period: resolvedPeriod,
    totalSpend,
    allTimeSpend,
    byVendor,
    byDimensions,
    needsDimensionConfig,
    periodEmpty,
    attribution,
    findings,
    unmappedKeyCount,
    historyDays,
    hasUserPlan: Boolean(budget),
    planName: budget?.name ?? null,
    planAnnualAmount,
    sampleDataLoadedAt,
    hasUserImports,
    dataMixed,
    empty: allTimeSpend < 0.01 && byVendor.length === 0,
    violations: [],
  };

  facts.violations = checkBriefInvariants(facts);

  if (facts.violations.length > 0 && process.env.NODE_ENV !== "production") {
    console.error("[brief] invariant violations", {
      orgId,
      period: resolvedPeriod.label,
      violations: facts.violations,
    });
  }

  return facts;
}

function usdPlain(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** Forecast card may show annualized vs plan only with enough history + a real plan. */
export function canShowBriefForecast(facts: BriefFacts): boolean {
  return facts.historyDays >= 60 && facts.hasUserPlan && facts.planAnnualAmount != null;
}
