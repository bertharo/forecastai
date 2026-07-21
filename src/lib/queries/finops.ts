import { db } from "@/db";
import * as s from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { countUnmappedKeys, listKeyRegistry } from "@/lib/keys/registry";
import { getBriefFacts, resolveBriefPeriod } from "@/lib/queries/brief";

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows: T[] }).rows ?? []) as T[];
  }
  return [];
}

export type CoverageBreakdown = {
  allocatedPct: number;
  totalSpend: number;
  allocatedSpend: number;
  joinedEmailSpend: number;
  keyRegistrySpend: number;
  unallocatedSpend: number;
  totalRows: number;
  allocatedRows: number;
};

/** Spend-weighted attribution coverage + email vs key-registry breakdown. */
export async function getAttributionCoverage(
  orgId: string,
  days = 30
): Promise<CoverageBreakdown> {
  const period = await resolveBriefPeriod(orgId, days);
  const result = await db.execute(sql`
    with base as (
      select
        cr.effective_cost::numeric as spend,
        cr.allocation_status,
        lower(trim(coalesce(cr.tags->>'email', cr.tags->>'user_email', ''))) as email,
        coalesce(cr.tags->>'api_key', cr.tags->>'apiKey', '') as api_key
      from cost_records cr
      where cr.org_id = ${orgId}::uuid
        and cr.charge_period_start >= ${period.start.toISOString()}::timestamptz
        and cr.charge_period_start < ${period.end.toISOString()}::timestamptz
    ),
    classified as (
      select
        spend,
        allocation_status,
        exists (
          select 1 from contributors c
          where c.org_id = ${orgId}::uuid
            and c.email = base.email
            and base.email <> ''
        ) as email_joined,
        exists (
          select 1 from provider_key_registry pkr
          where pkr.org_id = ${orgId}::uuid
            and pkr.kind = 'api_key'
            and pkr.external_id = base.api_key
            and pkr.dimension_node_id is not null
            and base.api_key <> ''
        ) as key_mapped
      from base
    )
    select
      coalesce(sum(spend), 0)::text as total_spend,
      coalesce(sum(spend) filter (where allocation_status = 'allocated'), 0)::text as allocated_spend,
      coalesce(sum(spend) filter (where email_joined), 0)::text as joined_email_spend,
      coalesce(sum(spend) filter (where key_mapped and not email_joined), 0)::text as key_registry_spend,
      coalesce(
        sum(spend) filter (
          where not email_joined
            and not key_mapped
            and allocation_status <> 'allocated'
        ),
        0
      )::text as unallocated_spend,
      count(*)::text as total_rows,
      count(*) filter (where allocation_status = 'allocated')::text as allocated_rows
    from classified
  `);

  const [data] = asRows<{
    total_spend: string;
    allocated_spend: string;
    joined_email_spend: string;
    key_registry_spend: string;
    unallocated_spend: string;
    total_rows: string;
    allocated_rows: string;
  }>(result);

  const totalSpend = Number(data?.total_spend ?? 0);
  const allocatedSpend = Number(data?.allocated_spend ?? 0);

  return {
    allocatedPct: totalSpend > 0 ? allocatedSpend / totalSpend : 0,
    totalSpend,
    allocatedSpend,
    joinedEmailSpend: Number(data?.joined_email_spend ?? 0),
    keyRegistrySpend: Number(data?.key_registry_spend ?? 0),
    unallocatedSpend: Number(data?.unallocated_spend ?? 0),
    totalRows: Number(data?.total_rows ?? 0),
    allocatedRows: Number(data?.allocated_rows ?? 0),
  };
}

export type FinopsFinding = {
  id: "terminated_seats" | "inactive_seats" | "unmapped_keys";
  title: string;
  severity: "high" | "medium" | "low";
  count: number;
  monthlyImpact: number;
  detail: string;
  href: string;
};

export async function getFinopsFindings(orgId: string): Promise<FinopsFinding[]> {
  const findings: FinopsFinding[] = [];

  const terminated = await db.execute(sql`
    select
      c.email,
      c.display_name,
      coalesce(sum(cr.effective_cost), 0)::text as spend
    from contributors c
    inner join cost_records cr
      on cr.org_id = c.org_id
      and lower(trim(coalesce(cr.tags->>'email', ''))) = c.email
      and cr.tags->>'seat_status' = 'terminated_active'
    where c.org_id = ${orgId}::uuid
      and (
        c.employment_status = 'terminated'
        or (c.ended_on is not null and c.ended_on < current_date)
      )
    group by c.email, c.display_name
    order by sum(cr.effective_cost) desc
  `);

  const termRows = asRows<{
    email: string;
    display_name: string;
    spend: string;
  }>(terminated);
  const termImpact = termRows.reduce((a, r) => a + Number(r.spend), 0);
  if (termRows.length > 0) {
    findings.push({
      id: "terminated_seats",
      title: "Terminated employees with active seats",
      severity: "high",
      count: termRows.length,
      monthlyImpact: termImpact,
      detail: `${termRows.length} people still billed for seats after end date · ~$${Math.round(termImpact).toLocaleString()}/mo`,
      href: "/import#roster",
    });
  }

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
  if (inactiveCount > 0) {
    const seatPrice = meta.seatPrice ?? 40;
    findings.push({
      id: "inactive_seats",
      title: "Inactive seats (30+ days)",
      severity: "medium",
      count: inactiveCount,
      monthlyImpact: inactiveCount * seatPrice,
      detail: `${inactiveCount} seats unused 30+ days · ~$${Math.round(inactiveCount * seatPrice).toLocaleString()}/mo`,
      href: "/connectors",
    });
  }

  const keys = await listKeyRegistry(orgId, { unmappedOnly: true });
  const unmappedApi = keys.filter((k) => k.kind === "api_key");
  const unmappedSpend = unmappedApi.reduce((a, k) => a + k.spend30d, 0);
  if (unmappedApi.length > 0) {
    findings.push({
      id: "unmapped_keys",
      title: "Unmapped API keys",
      severity: "high",
      count: unmappedApi.length,
      monthlyImpact: unmappedSpend,
      detail: `${unmappedApi.length} keys with $${Math.round(unmappedSpend).toLocaleString()} trailing spend — assign a team`,
      href: "/keys?unmapped=1",
    });
  }

  return findings;
}

/** @deprecated Prefer getBriefFacts — kept for call sites that need the old shape. */
export async function getFinopsDashboard(orgId: string, days = 30) {
  const period = await resolveBriefPeriod(orgId, days);
  const facts = await getBriefFacts(orgId, period);
  return {
    byVendor: facts.byVendor,
    byDimensions: facts.byDimensions,
    coverage: {
      allocatedPct: facts.attribution.attributedPct,
      totalSpend: facts.attribution.totalSpend,
      allocatedSpend: facts.attribution.attributedSpend,
      joinedEmailSpend: facts.attribution.emailJoinSpend,
      keyRegistrySpend: facts.attribution.keyRegistrySpend,
      unallocatedSpend: facts.attribution.unallocatedSpend,
      totalRows: 0,
      allocatedRows: 0,
    },
    findings: facts.findings.map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      count: f.count,
      monthlyImpact: f.impact,
      detail: f.detail,
      href: f.href,
    })),
    sampleDataLoadedAt: facts.sampleDataLoadedAt,
    empty: facts.empty,
    periodEmpty: facts.periodEmpty,
    period: facts.period,
    violations: facts.violations,
    dataMixed: facts.dataMixed,
    needsDimensionConfig: facts.needsDimensionConfig,
  };
}

export const countUnmappedApiKeys = countUnmappedKeys;
