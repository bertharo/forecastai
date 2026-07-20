import Link from "next/link";
import { Suspense } from "react";
import { FilterBar } from "@/components/FilterBar";
import { assertDb } from "@/db";
import {
  getCurrentOrg,
  getDimensionNodes,
  getDimensionTypes,
} from "@/lib/queries/org";
import { parseAnalyticsFilters } from "@/lib/queries/filters";
import { getFilterOptions, getSpendSummary } from "@/lib/queries/spend";
import { getUnallocatedClusters } from "@/lib/queries/allocation";
import { getStaleConnectors } from "@/lib/connectors/staleness";
import { getAiCostSummary } from "@/lib/queries/ai-cost";
import {
  canShowBriefForecast,
  getBriefFacts,
  trailingBriefPeriod,
  type BriefFacts,
} from "@/lib/queries/brief";
import { Metric } from "@/components/Metric";
import { FinopsOnePager } from "@/components/FinopsOnePager";
import { SetupChecklist } from "@/components/SetupChecklist";
import { EmptyState } from "@/components/EmptyState";
import { formatCostPerMTokens, pct, usd } from "@/lib/format";
import { IconChevron } from "@/components/shell/icons";
import { countUnmappedKeys } from "@/lib/keys/registry";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function BriefView({
  summary,
  clusters,
  aiCost,
  facts,
  setup,
}: {
  summary: Awaited<ReturnType<typeof getSpendSummary>>;
  clusters: Awaited<ReturnType<typeof getUnallocatedClusters>>;
  aiCost: Awaited<ReturnType<typeof getAiCostSummary>>;
  facts: BriefFacts;
  setup: {
    hasSource: boolean;
    keysMapped: boolean;
    hasPlan: boolean;
  };
}) {
  const showForecast = canShowBriefForecast(facts);
  const forecast = summary.runRate * 12 || facts.totalSpend * 12;
  const plan = facts.planAnnualAmount;
  const gap = plan != null ? forecast - plan : 0;
  const overPct = plan != null && plan > 0 ? gap / plan : 0;

  const empty = facts.empty;
  const attention = empty
    ? []
    : [
        {
          initials: "AI",
          color: "var(--warning)",
          name: "AI coding tools",
          role: "AI cost",
          body: `${usd(aiCost.spend.value)} trailing ${aiCost.from.slice(5)}→${aiCost.to.slice(5)} across ${aiCost.activeContributors} contributors · cost/PR ${aiCost.mergedPrs ? usd(aiCost.costPerPr.value) : "—"}.`,
        },
        {
          initials: "PR",
          color: "var(--accent)",
          name: "Product Copilot",
          role: "Budget pace",
          body: `Support Copilot is ${pct(summary.budget?.mtdPct ?? 0.84, 0)} of org budget pace. Model a change to shift Sonnet → Haiku.`,
        },
        {
          initials: "MK",
          color: "var(--success)",
          name: "Allocation",
          role: "FinOps",
          body:
            clusters[0]
              ? `${clusters.length} unallocated clusters · top ${usd(clusters[0].spend)} (${clusters[0].feature ?? clusters[0].source ?? "unknown"}). Triage on Alerts.`
              : "Allocation looks clean this week — keep tagging spans with feature + team.",
        },
      ];

  return (
    <div className="space-y-6">
      <SetupChecklist
        steps={[
          {
            id: "source",
            label: "Connect a source",
            href: "/connectors",
            done: setup.hasSource,
          },
          {
            id: "keys",
            label: "Map keys to teams",
            href: "/keys",
            done: setup.keysMapped,
          },
          {
            id: "plan",
            label: "Set a plan",
            href: "/budgets",
            done: setup.hasPlan,
          },
        ]}
      />

      <FinopsOnePager facts={facts} />

      {!empty && (
        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <div className="panel p-4">
            {showForecast && plan != null ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[13px] font-semibold">FY26 Forecast</div>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
                    style={{
                      background:
                        overPct >= 0 ? "rgba(196,59,59,0.12)" : "rgba(31,122,69,0.12)",
                      color: overPct >= 0 ? "var(--danger)" : "var(--success)",
                    }}
                  >
                    {pct(Math.abs(overPct), 1)} {overPct >= 0 ? "over" : "under"} plan
                  </span>
                </div>
                <div className="kpi mt-3">{usd(forecast)}</div>
                <p className="mt-3 max-w-xl text-[14px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  Annualized run rate vs {facts.planName ?? "plan"} ({usd(plan)}).{" "}
                  {pct(facts.attribution.attributedPct, 0)} of {facts.period.label} spend is
                  attributed.
                </p>
              </>
            ) : (
              <>
                <div className="text-[13px] font-semibold">Trailing spend</div>
                <div className="kpi mt-3">{usd(facts.totalSpend)}</div>
                <p className="mt-3 max-w-xl text-[14px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  {facts.period.label} · {pct(facts.attribution.attributedPct, 0)} attributed.
                  {!facts.hasUserPlan
                    ? " Set a plan under Plan to see forecast vs plan."
                    : ` Need ≥60 days of history for a forecast (have ${facts.historyDays}).`}
                </p>
                <Link href="/budgets" className="btn mt-4 inline-block">
                  Set a plan →
                </Link>
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="panel p-4">
              <div className="text-[13px] font-semibold">Plan of record</div>
              {facts.hasUserPlan && plan != null ? (
                <>
                  <div className="kpi mt-2">{usd(plan)}</div>
                  <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
                    {facts.planName}
                    {summary.budget ? ` · MTD ${pct(summary.budget.mtdPct, 0)} used` : ""}
                  </p>
                </>
              ) : (
                <>
                  <div className="kpi mt-2" style={{ fontSize: "1.5rem" }}>
                    —
                  </div>
                  <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
                    No org budget —{" "}
                    <Link href="/budgets" className="underline">
                      set one under Plan
                    </Link>
                  </p>
                </>
              )}
            </div>
            <div className="panel p-4">
              <div className="text-[13px] font-semibold">AI cost / merged PR</div>
              <div className="mt-2 text-[1.75rem] font-bold">
                <Metric
                  metric={aiCost.costPerPr}
                  display={aiCost.mergedPrs ? usd(aiCost.costPerPr.value) : "—"}
                />
              </div>
              <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
                {usd(aiCost.spend.value)} coding-tool spend · {aiCost.mergedPrs} PRs ·{" "}
                <Link href="/ai-cost" className="underline">
                  AI cost
                </Link>
              </p>
            </div>
          </div>
        </div>
      )}

      {attention.length > 0 && (
        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[17px] font-bold tracking-tight">Needs your attention</h2>
              <p className="text-[13px]" style={{ color: "var(--muted)" }}>
                {attention.length} drivers · top of the gap
              </p>
            </div>
            <Link href="/allocation" className="text-[13px] font-semibold">
              See all →
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {attention.map((a) => (
              <div key={a.name} className="row-card">
                <div className="mb-3 flex items-center gap-2.5">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold text-white"
                    style={{
                      background:
                        a.color === "var(--warning)"
                          ? "#c45a2a"
                          : a.color === "var(--success)"
                            ? "#1f7a45"
                            : "#12141a",
                    }}
                  >
                    {a.initials}
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold">{a.name}</div>
                    <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                      {a.role}
                    </div>
                  </div>
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  {a.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BreakdownView({
  summary,
  mode,
}: {
  summary: Awaited<ReturnType<typeof getSpendSummary>>;
  mode: "vendor" | "team" | "feature";
}) {
  const rows =
    mode === "team"
      ? summary.byTeam.map((r) => ({
          key: r.nodeId,
          label: r.team,
          sub: "Team slice",
          value: r.effective,
          tokens: r.tokens,
          abbr: r.team.slice(0, 3).toUpperCase(),
          href: `/?tab=org&node=${r.nodeId}`,
        }))
      : mode === "feature"
        ? summary.byFeature.map((r) => ({
            key: r.feature,
            label: r.feature,
            sub: "Feature",
            value: r.effective,
            tokens: r.tokens,
            abbr: r.feature.slice(0, 3).toUpperCase(),
            href: `/?tab=breakdown&feature=${encodeURIComponent(r.feature)}`,
          }))
        : summary.byProvider.map((r) => ({
            key: r.key,
            label: r.name,
            sub: "Vendor",
            value: r.effective,
            tokens: r.tokens,
            abbr: r.name.slice(0, 3).toUpperCase(),
            href: `/?tab=breakdown&provider=${encodeURIComponent(r.key)}`,
          }));

  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const max = Math.max(...rows.map((r) => r.value), 1);

  if (rows.length === 0) {
    return (
      <EmptyState
        message="No spend to break down yet."
        action={{ href: "/connectors", label: "Connect a source" }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold">
            Spend breakdown{" "}
            <span className="font-medium" style={{ color: "var(--muted)" }}>
              {rows.length} · {usd(total)} total
            </span>
          </h2>
          <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
            Same total, three lenses — vendor, feature, or team.
          </p>
        </div>
        <div className="flex gap-1.5">
          {(
            [
              ["vendor", "By vendor"],
              ["feature", "By feature"],
              ["team", "By department"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={`/?tab=breakdown&slice=${key}`}
              className="pill-tab"
              data-active={mode === key}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {rows.slice(0, 12).map((r) => (
          <Link
            key={r.key}
            href={r.href}
            className="row-card flex items-center gap-3 transition-shadow hover:shadow-sm"
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{ background: "var(--panel-soft)" }}
            >
              {r.abbr}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{r.label}</div>
              <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                {r.sub}
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full"
                style={{ background: "var(--panel-soft)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(r.value / max) * 100}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[15px] font-bold">{usd(r.value)}</div>
              <div className="text-[12px]" style={{ color: "var(--success)" }}>
                {pct(r.value / total, 0)}
              </div>
            </div>
            <div className="w-[5.5rem] shrink-0 text-right">
              <div className="text-[13px] font-semibold">
                {formatCostPerMTokens(r.value, r.tokens)}
              </div>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                $ / M tokens
              </div>
            </div>
            <span style={{ color: "var(--muted)" }}>
              <IconChevron />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ByOrgView({
  summary,
}: {
  summary: Awaited<ReturnType<typeof getSpendSummary>>;
}) {
  const teams = summary.byTeam;
  const total = teams.reduce((a, t) => a + t.effective, 0) || 1;

  if (teams.length === 0) {
    return (
      <EmptyState
        message="No team spend yet. Map keys or import a roster to slice by org."
        action={{ href: "/keys", label: "Map keys" }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[14px]" style={{ color: "var(--muted)" }}>
        Team slices for the trailing 30 days — {teams.length} teams, {usd(total)}{" "}
        attributed.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((t) => (
          <Link
            key={t.nodeId}
            href={`/?dim=team&node=${t.nodeId}`}
            className="row-card transition-shadow hover:shadow-sm"
          >
            <div className="text-[14px] font-semibold">{t.team}</div>
            <div className="kpi mt-2" style={{ fontSize: "1.5rem" }}>
              {usd(t.effective)}
            </div>
            <div className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
              {pct(t.effective / total, 0)} of attributed spend
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await assertDb();
    const sp = await searchParams;
    const tab = typeof sp.tab === "string" ? sp.tab : "brief";
    const slice =
      typeof sp.slice === "string" && ["vendor", "team", "feature"].includes(sp.slice)
        ? (sp.slice as "vendor" | "team" | "feature")
        : "vendor";
    const filters = parseAnalyticsFilters(sp);
    const org = await getCurrentOrg();
    if (!org) {
      return (
        <EmptyState
          message="Open a workspace to see AI spend and forecasts."
          action={{ href: "/onboarding", label: "Open Workspaces" }}
        />
      );
    }

    const briefPeriod = trailingBriefPeriod(30);
    const [types, nodes, summary, options, stale, clusters, aiCost, facts, unmapped, costCount, keyCount] =
      await Promise.all([
        getDimensionTypes(org.id),
        getDimensionNodes(org.id),
        getSpendSummary(org.id, filters),
        getFilterOptions(org.id),
        getStaleConnectors(org.id),
        getUnallocatedClusters(org.id, 30),
        getAiCostSummary(org.id, { days: 30 }),
        getBriefFacts(org.id, briefPeriod),
        countUnmappedKeys(org.id),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(s.costRecords)
          .where(eq(s.costRecords.orgId, org.id))
          .then((r) => Number(r[0]?.n ?? 0)),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(s.providerKeyRegistry)
          .where(eq(s.providerKeyRegistry.orgId, org.id))
          .then((r) => Number(r[0]?.n ?? 0)),
      ]);

    const hasSource = costCount > 0 || !facts.empty;
    const setup = {
      hasSource,
      keysMapped: keyCount > 0 ? unmapped === 0 : hasSource,
      hasPlan: facts.hasUserPlan,
    };

    return (
      <div className="space-y-4">
        {stale.length > 0 && (
          <div
            className="rounded-[var(--radius-sm)] border px-4 py-3 text-[13px]"
            style={{
              borderColor: "rgba(196,90,42,0.35)",
              background: "rgba(196,90,42,0.08)",
              color: "var(--warning)",
            }}
          >
            <strong>Stale data sources</strong> —{" "}
            {stale
              .map(
                (c) =>
                  `${c.displayName} last synced ${c.hoursAgo}h ago (threshold ${c.staleAfterHours}h)`
              )
              .join(" · ")}
          </div>
        )}

        {(tab === "org" || tab === "breakdown") && (
          <Suspense fallback={null}>
            <div className="mb-2">
              <FilterBar
                types={types.map((t) => ({
                  id: t.id,
                  key: t.key,
                  displayName: t.displayName,
                }))}
                nodes={nodes.map((n) => ({
                  id: n.id,
                  key: n.key,
                  displayName: n.displayName,
                  dimensionTypeId: n.dimensionTypeId,
                  parentId: n.parentId,
                  path: n.path,
                  costCenterCode: n.costCenterCode,
                }))}
                providers={options.providers}
                models={options.models}
                features={options.features}
                showMetric={false}
              />
            </div>
          </Suspense>
        )}

        {tab === "breakdown" ? (
          <BreakdownView summary={summary} mode={slice} />
        ) : tab === "org" ? (
          <ByOrgView summary={summary} />
        ) : (
          <BriefView
            summary={summary}
            clusters={clusters}
            aiCost={aiCost}
            facts={facts}
            setup={setup}
          />
        )}
      </div>
    );
  } catch (e) {
    return (
      <div className="panel p-4">
        <p style={{ color: "var(--danger)" }}>
          Failed to load: {e instanceof Error ? e.message : String(e)}
        </p>
      </div>
    );
  }
}
