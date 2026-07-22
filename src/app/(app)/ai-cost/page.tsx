import Link from "next/link";
import { getCurrentOrg, getDimensionNodes } from "@/lib/queries/org";
import { getAiCostSummary } from "@/lib/queries/ai-cost";
import { findOverlappingAiSources } from "@/lib/ai-tools/persist";
import { Metric } from "@/components/Metric";
import { formatCostPerMTokens, usd, pct } from "@/lib/format";
import { AiCostActions } from "./AiCostActions";
import { ContributorTable } from "./ContributorTable";
import { PivotTable } from "./PivotTable";
import { getAiCostPivot } from "@/lib/queries/ai-cost-pivot";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function AiCostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const org = await getCurrentOrg();
  if (!org) {
    return (
      <EmptyState
        message="Open a workspace to see coding-tool spend."
        action={{ href: "/onboarding", label: "Open Workspaces" }}
      />
    );
  }

  const sp = await searchParams;
  // Trailing window length is fixed — only the "as of" end date is
  // user-adjustable, so there's exactly one control for "what window am I
  // looking at" instead of two that can contradict each other.
  const days = 30;
  const tool = typeof sp.tool === "string" ? sp.tool : null;
  const team = typeof sp.team === "string" ? sp.team : null;
  const asOfParam = typeof sp.asOf === "string" ? sp.asOf : null;
  const asOf = asOfParam ? new Date(`${asOfParam}T00:00:00.000Z`) : undefined;

  /** Builds a drill-down href that keeps the current "as of" date. */
  function drillHref(extra: Record<string, string>): string {
    const qs = new URLSearchParams();
    if (asOfParam) qs.set("asOf", asOfParam);
    for (const [k, v] of Object.entries(extra)) qs.set(k, v);
    return `/ai-cost?${qs.toString()}`;
  }

  const hier = typeof sp.hier === "string" ? sp.hier : null;

  const [summary, overlaps, nodes, pivot] = await Promise.all([
    getAiCostSummary(org.id, { days, toolKey: tool, teamNodeId: team, asOf }),
    findOverlappingAiSources(org.id, days),
    getDimensionNodes(org.id),
    getAiCostPivot(org.id, { asOf, toolKey: tool, familyBase: hier }),
  ]);

  const teams = nodes.filter((n) => n.path.split("/").filter(Boolean).length >= 2);
  const noData = summary.byTool.length === 0 && summary.spend.value === 0;

  return (
    <div className="space-y-5">
      {noData && (
        <EmptyState
          message="No coding-tool spend yet (Claude, Cursor, Copilot, ChatGPT). Gemini and Perplexity stay on Brief / FinOps — they are not coding-tool grains. Upload a spend spreadsheet under Sources, or sync a coding-tool connector."
          action={{ href: "/connectors", label: "Open Sources" }}
        />
      )}

      {overlaps.length > 0 && (
        <div
          className="rounded-[var(--radius-sm)] border px-4 py-3 text-[13px]"
          style={{
            borderColor: "rgba(196,90,42,0.35)",
            background: "rgba(196,90,42,0.08)",
            color: "var(--warning)",
          }}
        >
          <strong>Possible duplicate sources</strong> — {overlaps.length} day/tool
          overlaps. Set a primary source per tool under Sources.
        </div>
      )}

      <AiCostActions tools={summary.byTool.map((t) => t.toolKey)} teams={teams.map((t) => ({ id: t.id, key: t.key, name: t.displayName }))} />

      <div className="muted text-[12px]">
        Window: {summary.from} → {summary.to}
        {asOfParam ? ` (as of ${asOfParam})` : " (as of today)"}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="row-card">
          <div className="muted text-[11px] uppercase">Coding-tool spend</div>
          <div className="mt-1 text-[1.75rem] font-bold">
            <Metric metric={summary.spend} display={usd(summary.spend.value)} />
          </div>
          <div className="muted mt-1 text-[11px]">
            Trailing {days}d · excludes Gemini / Perplexity
          </div>
        </div>
        <div className="row-card">
          <div className="muted text-[11px] uppercase">Cost / merged PR</div>
          <div className="mt-1 text-[1.75rem] font-bold">
            <Metric
              metric={summary.costPerPr}
              display={summary.mergedPrs ? usd(summary.costPerPr.value) : "—"}
            />
          </div>
          <div className="muted mt-1 text-[11px]">{summary.mergedPrs} PRs</div>
        </div>
        <div className="row-card">
          <div className="muted text-[11px] uppercase">$ / M tokens</div>
          <div className="kpi mt-1" style={{ fontSize: "1.75rem" }}>
            {formatCostPerMTokens(summary.spend.value, summary.tokens)}
          </div>
        </div>
        <div className="row-card">
          <div className="muted text-[11px] uppercase">Tokens</div>
          <div className="kpi mt-1" style={{ fontSize: "1.75rem" }}>
            {Math.round(summary.tokens).toLocaleString()}
          </div>
        </div>
        <div className="row-card">
          <div className="muted text-[11px] uppercase">Active contributors</div>
          <div className="kpi mt-1" style={{ fontSize: "1.75rem" }}>
            {summary.activeContributors}
          </div>
        </div>
        <div className="row-card">
          <div className="muted text-[11px] uppercase">Avg spend / user</div>
          <div className="mt-1 text-[1.75rem] font-bold">
            <Metric
              metric={summary.avgSpendPerUser}
              display={
                summary.activeContributors
                  ? usd(summary.avgSpendPerUser.value, { digits: 2 })
                  : "—"
              }
            />
          </div>
          <div className="muted mt-1 text-[11px]">
            Across {summary.activeContributors} active user
            {summary.activeContributors === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {pivot && (
        <div className="panel overflow-x-auto p-4">
          <h2 className="mb-3 text-sm font-semibold">By org hierarchy</h2>
          <PivotTable pivot={pivot} />
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold">By tool</h2>
          <ul className="space-y-2">
            {summary.byTool.map((t) => {
              const share = summary.spend.value
                ? t.spend / summary.spend.value
                : 0;
              return (
                <li key={t.toolKey}>
                  <Link
                    href={drillHref({ tool: t.toolKey })}
                    className="row-card flex items-center justify-between gap-2"
                  >
                    <span className="font-medium">{t.toolKey}</span>
                    <span className="mono text-right text-[13px]">
                      <div>
                        {usd(t.spend)} · {pct(share, 0)}
                      </div>
                      <div className="muted text-[11px]">
                        {formatCostPerMTokens(t.spend, t.tokens)} · $ / M tokens
                      </div>
                    </span>
                  </Link>
                </li>
              );
            })}
            {summary.byTool.length === 0 && (
              <li className="muted text-[13px]">
                No coding-tool grains yet — Claude / Cursor / Copilot / ChatGPT from a spreadsheet
                or connector. Gemini &amp; Perplexity appear on Brief instead.
              </li>
            )}
          </ul>
        </div>
        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold">By team</h2>
          <ul className="space-y-2">
            {summary.byTeam.map((t) => (
              <li key={t.nodeId}>
                <Link
                  href={drillHref({ team: t.nodeId })}
                  className="row-card flex items-center justify-between gap-2"
                >
                  <span className="font-medium">{t.team}</span>
                  <span className="mono text-right text-[13px]">
                    <div>{usd(t.spend)}</div>
                    <div className="muted text-[11px]">
                      {formatCostPerMTokens(t.spend, t.tokens)} · $ / M tokens
                    </div>
                  </span>
                </Link>
              </li>
            ))}
            {summary.byTeam.length === 0 && (
              <li className="muted text-[13px]">
                Assign contributors to teams to see team roll-up.
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="panel overflow-x-auto p-4">
        <h2 className="mb-3 text-sm font-semibold">By contributor</h2>
        <ContributorTable contributors={summary.byContributor} />
      </div>
    </div>
  );
}
