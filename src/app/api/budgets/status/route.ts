import { NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/queries/org";
import { getStatusFromSnapshots } from "@/lib/budgets/status";

/**
 * Fast budget status for gateway pre-call hooks (LiteLLM etc.).
 * Served from materialized budget_status_snapshots (refreshed if stale).
 *
 * Query: ?team=support&feature=support_copilot&node=<uuid>
 * Auth: org cookie today; org API key can be added with WS6.
 */
export async function GET(req: Request) {
  const org = await getCurrentOrg();
  if (!org) {
    return NextResponse.json({ error: "No org" }, { status: 404 });
  }
  const url = new URL(req.url);
  const team = url.searchParams.get("team") ?? undefined;
  const feature = url.searchParams.get("feature") ?? undefined;
  const node = url.searchParams.get("node") ?? undefined;

  const rows = await getStatusFromSnapshots(org.id, {
    team,
    featureKey: feature,
    dimensionNodeId: node,
  });

  // Prefer most restrictive matching status for gateway consumers
  const rank = { exceeded: 3, warn: 2, ok: 1 } as const;
  const primary = [...rows].sort(
    (a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0)
  )[0];

  return NextResponse.json({
    orgId: org.id,
    status: primary?.status ?? "ok",
    policy_action: primary?.policy_action ?? null,
    remaining: primary?.remaining ?? null,
    period_end: primary?.period_end ?? null,
    recommended_model: primary?.recommended_model ?? null,
    budgets: rows,
    gateway_pattern:
      "LiteLLM pre-call: GET /api/budgets/status?team=&feature= → if policy_action=advisory_block|advisory_downgrade, reroute/block in the gateway. Meter recommends; gateway enforces.",
  });
}
