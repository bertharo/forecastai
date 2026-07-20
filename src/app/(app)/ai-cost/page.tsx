import Link from "next/link";
import { getCurrentOrg, getDimensionNodes } from "@/lib/queries/org";
import { getAiCostSummary } from "@/lib/queries/ai-cost";
import { findOverlappingAiSources } from "@/lib/ai-tools/persist";
import { Metric } from "@/components/Metric";
import { formatCostPerMTokens, usd, pct } from "@/lib/format";
import { AiCostActions } from "./AiCostActions";
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
  const days = Number(typeof sp.days === "string" ? sp.days : 30);
  const tool = typeof sp.tool === "string" ? sp.tool : null;
  const team = typeof sp.team === "string" ? sp.team : null;

  const [summary, overlaps, nodes] = await Promise.all([
    getAiCostSummary(org.id, { days, toolKey: tool, teamNodeId: team }),
    findOverlappingAiSources(org.id, days),
    getDimensionNodes(org.id),
  ]);

  const teams = nodes.filter((n) => n.path.split("/").filter(Boolean).length >= 2);
  const noData = summary.byTool.length === 0 && summary.spend.value === 0;

  return (
    <div className="space-y-5">
      {noData && (
        <EmptyState
          message="No coding-tool spend yet. Sync Claude, Cursor, or Copilot under Sources."
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

      <AiCostActions days={days} tools={summary.byTool.map((t) => t.toolKey)} teams={teams.map((t) => ({ id: t.id, key: t.key, name: t.displayName }))} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="row-card">
          <div className="muted text-[11px] uppercase">Spend</div>
          <div className="mt-1 text-[1.75rem] font-bold">
            <Metric metric={summary.spend} display={usd(summary.spend.value)} />
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
      </div>

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
                    href={`/ai-cost?days=${days}&tool=${t.toolKey}`}
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
                No AI tool data yet — sync Claude/Cursor demo or import a DX export.
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
                  href={`/ai-cost?days=${days}&team=${t.nodeId}`}
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
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Team</th>
              <th className="text-right">Spend</th>
              <th className="text-right">Tokens</th>
              <th className="text-right">$ / M tokens</th>
            </tr>
          </thead>
          <tbody>
            {summary.byContributor.map((c) => (
              <tr key={c.contributorId}>
                <td>
                  <div className="font-medium">{c.name}</div>
                  <div className="muted text-[11px]">{c.email}</div>
                </td>
                <td>{c.team ?? "—"}</td>
                <td className="mono text-right">{usd(c.spend)}</td>
                <td className="mono text-right">
                  {Math.round(c.tokens).toLocaleString()}
                </td>
                <td className="mono text-right">
                  {formatCostPerMTokens(c.spend, c.tokens)}
                </td>
              </tr>
            ))}
            {summary.byContributor.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No contributor-attributed AI spend in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
