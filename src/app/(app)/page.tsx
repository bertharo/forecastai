import Link from "next/link";
import { Suspense, type ReactNode } from "react";
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
import { getFinopsDashboard } from "@/lib/queries/finops";
import { Metric } from "@/components/Metric";
import { FinopsOnePager } from "@/components/FinopsOnePager";
import { LoadSampleButton } from "@/components/LoadSampleButton";
import { pct, usd } from "@/lib/format";
import { IconChevron } from "@/components/shell/icons";

export const dynamic = "force-dynamic";

function ActionOrb({
  label,
  href,
  icon,
}: {
  label: string;
  href: string;
  icon: ReactNode;
}) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1.5">
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full text-white"
        style={{ background: "#12141a" }}
      >
        {icon}
      </span>
      <span className="text-[12px] font-medium">{label}</span>
    </Link>
  );
}

function BriefView({
  orgName,
  summary,
  clusters,
  aiCost,
  finops,
}: {
  orgName: string;
  summary: Awaited<ReturnType<typeof getSpendSummary>>;
  clusters: Awaited<ReturnType<typeof getUnallocatedClusters>>;
  aiCost: Awaited<ReturnType<typeof getAiCostSummary>>;
  finops: Awaited<ReturnType<typeof getFinopsDashboard>>;
}) {
  // Compare annual forecast to an annualized plan (budget amounts are period-scoped).
  const forecast = summary.runRate * 12 || summary.trailing30 * 12;
  const plan = summary.budget
    ? summary.budget.period === "annual"
      ? summary.budget.amount
      : summary.budget.period === "quarterly"
        ? summary.budget.amount * 4
        : summary.budget.amount * 12
    : summary.runRate * 0.85 * 12;
  const gap = forecast - plan;
  const overPct = plan > 0 ? gap / plan : 0;

  const empty = summary.trailing30 < 1 && finops.empty;
  const attention = empty
    ? [
        {
          initials: "1",
          color: "#2f5bd8",
          name: "Load sample data",
          role: "FinOps",
          body: "One click: ~2,000-person roster, vendor spend, terminated seats, and unmapped keys — no connectors.",
        },
        {
          initials: "2",
          color: "#7c5cbf",
          name: "Or import CSVs",
          role: "Import",
          body: "Upload an HRIS roster and a vendor usage / seat CSV. Department joins on email only.",
        },
        {
          initials: "3",
          color: "#2a9d8f",
          name: "Open the Northstar demo",
          role: "Workspaces",
          body: "Want the fuller product tour? Open Workspaces and tap “Open the demo”.",
        },
      ]
    : [
        {
          initials: "AI",
          color: "#e8843a",
          name: "AI coding tools",
          role: "AI cost",
          body: `${usd(aiCost.spend.value)} trailing ${aiCost.from.slice(5)}→${aiCost.to.slice(5)} across ${aiCost.activeContributors} contributors · cost/PR ${aiCost.mergedPrs ? usd(aiCost.costPerPr.value) : "—"}.`,
        },
        {
          initials: "PR",
          color: "#7c5cbf",
          name: "Product Copilot",
          role: "Budget pace",
          body: `Support Copilot is ${pct(summary.budget?.mtdPct ?? 0.84, 0)} of org budget pace. Model a change to shift Sonnet → Haiku.`,
        },
        {
          initials: "MK",
          color: "#2a9d8f",
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
      <FinopsOnePager dash={finops} />

      {empty && (
        <div className="flex flex-wrap gap-3">
          <LoadSampleButton />
          <Link href="/import" className="btn btn-ghost">
            Import CSV →
          </Link>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="soft-card" style={{ background: "var(--card-blue)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] font-semibold">FY26 Forecast</div>
            <span
              className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
              style={{
                background: "rgba(196,59,59,0.12)",
                color: "var(--danger)",
              }}
            >
              ▲ {pct(Math.abs(overPct), 1)} {overPct >= 0 ? "over" : "under"} plan
            </span>
          </div>
          <div className="kpi mt-3">{usd(forecast)}</div>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed" style={{ color: "#3a4050" }}>
            {orgName} annualized run rate vs plan of record ({usd(plan)}).{" "}
            {pct(summary.allocatedPct, 0)} of trailing spend is allocated.{" "}
            {summary.anomalies.length > 0
              ? `${summary.anomalies.length} anomaly day(s) in the last 60d.`
              : "No spend anomalies flagged in the last 60d."}{" "}
            Top features drive most of the gap — open Model a change to shift routing.
          </p>
          <div className="mt-6 flex flex-wrap gap-5">
            <ActionOrb
              label="Model"
              href="/scenarios"
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 11 L8 3 L13 11 Z" stroke="white" strokeWidth="1.5" />
                </svg>
              }
            />
            <ActionOrb
              label="Share"
              href="/budgets"
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="12" cy="4" r="1.5" fill="white" />
                  <circle cx="4" cy="8" r="1.5" fill="white" />
                  <circle cx="12" cy="12" r="1.5" fill="white" />
                  <path d="M5.5 7.5 L10.5 4.5M5.5 8.5 L10.5 11.5" stroke="white" strokeWidth="1.25" />
                </svg>
              }
            />
            <ActionOrb
              label="Approve"
              href="/budgets"
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" stroke="white" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              }
            />
            <ActionOrb
              label="Compare"
              href="/?tab=breakdown"
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 12 V6M7 12 V3M11 12 V8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              }
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <div className="soft-card" style={{ background: "var(--card-pink)" }}>
            <div className="text-[13px] font-semibold">Plan of record</div>
            <div className="kpi mt-2">{usd(plan)}</div>
            <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
              {summary.budget
                ? `${summary.budget.name} · MTD ${pct(summary.budget.mtdPct, 0)} used`
                : "No org budget — set one under Plan"}
            </p>
          </div>
          <div className="soft-card" style={{ background: "var(--card-green)" }}>
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
                  style={{ background: a.color }}
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
              <p className="text-[13px] leading-relaxed" style={{ color: "#3a4050" }}>
                {a.body}
              </p>
            </div>
          ))}
        </div>
      </div>
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
          abbr: r.team.slice(0, 3).toUpperCase(),
          href: `/?tab=org&node=${r.nodeId}`,
        }))
      : mode === "feature"
        ? summary.byFeature.map((r) => ({
            key: r.feature,
            label: r.feature,
            sub: "Feature",
            value: r.effective,
            abbr: r.feature.slice(0, 3).toUpperCase(),
            href: `/?tab=breakdown&feature=${encodeURIComponent(r.feature)}`,
          }))
        : summary.byProvider.map((r) => ({
            key: r.key,
            label: r.name,
            sub: "Vendor",
            value: r.effective,
            abbr: r.name.slice(0, 3).toUpperCase(),
            href: `/?tab=breakdown&provider=${encodeURIComponent(r.key)}`,
          }));

  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div className="space-y-4">
      <div className="soft-card" style={{ background: "var(--card-blue)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          Breakdown
        </div>
        <p className="mt-2 max-w-2xl text-[16px] font-medium leading-snug">
          {usd(summary.trailing30)} trailing 30d, sliced three ways. Same total — a
          different lens on where it runs, who you pay, and who&apos;s consuming it.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold">
            Spend breakdown{" "}
            <span className="font-medium" style={{ color: "var(--muted)" }}>
              {rows.length} · {usd(total)} total
            </span>
          </h2>
          <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
            Click a row to drill into filters. Aggregated from live cost records.
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
              style={{ background: "var(--card-blue)" }}
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
                    background: "#2f5bd8",
                  }}
                />
              </div>
            </div>
            <div className="text-right">
              <div className="text-[15px] font-bold">{usd(r.value)}</div>
              <div className="text-[12px]" style={{ color: "var(--success)" }}>
                {pct(r.value / total, 0)}
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

  return (
    <div className="space-y-4">
      <div className="soft-card" style={{ background: "var(--card-blue)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          By org
        </div>
        <p className="mt-2 max-w-2xl text-[16px] font-medium leading-snug">
          Team slices for the trailing 30 days — {teams.length} teams, {usd(total)}{" "}
          attributed.
        </p>
      </div>
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
        <div className="soft-card space-y-3" style={{ background: "var(--card-blue)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider muted">
            Get started
          </div>
          <p className="text-[18px] font-semibold leading-snug">
            Open a workspace to see AI spend and forecasts.
          </p>
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--muted)" }}>
            A workspace is your private folder for this company. No account needed — try the
            sample demo or start empty.
          </p>
          <a className="btn inline-block" href="/onboarding">
            Get started →
          </a>
        </div>
      );
    }

    const [types, nodes, summary, options, stale, clusters, aiCost, finops] =
      await Promise.all([
        getDimensionTypes(org.id),
        getDimensionNodes(org.id),
        getSpendSummary(org.id, filters),
        getFilterOptions(org.id),
        getStaleConnectors(org.id),
        getUnallocatedClusters(org.id, 30),
        getAiCostSummary(org.id, { days: 30 }),
        getFinopsDashboard(org.id, 30),
      ]);

    return (
      <div className="space-y-4">
        {stale.length > 0 && (
          <div
            className="soft-card text-[13px]"
            style={{ background: "#fff6e8", color: "var(--warning)" }}
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
            orgName={org.name}
            summary={summary}
            clusters={clusters}
            aiCost={aiCost}
            finops={finops}
          />
        )}
      </div>
    );
  } catch (e) {
    return (
      <div className="soft-card">
        <p style={{ color: "var(--danger)" }}>
          Failed to load: {e instanceof Error ? e.message : String(e)}
        </p>
      </div>
    );
  }
}
