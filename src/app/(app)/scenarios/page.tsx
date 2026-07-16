import { Money } from "@/components/Money";
import { DataTable } from "@/components/DataTable";
import { CommitmentOptimizerPanel } from "@/components/CommitmentOptimizerPanel";
import { getDemoOrg } from "@/lib/queries/org";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { modelSwitchDelta, type PriceLine, type RouteSplit } from "@/lib/forecast/engine";

export const dynamic = "force-dynamic";

export default async function ScenariosPage() {
  const org = await getDemoOrg();
  if (!org) return <p className="muted">No org — run npm run db:seed</p>;

  const scenarios = await db
    .select()
    .from(s.scenarios)
    .where(eq(s.scenarios.orgId, org.id));

  const overrides = await db
    .select({
      id: s.scenarioOverrides.id,
      scenarioId: s.scenarioOverrides.scenarioId,
      overrideType: s.scenarioOverrides.overrideType,
      payload: s.scenarioOverrides.payload,
    })
    .from(s.scenarioOverrides)
    .innerJoin(s.scenarios, eq(s.scenarioOverrides.scenarioId, s.scenarios.id))
    .where(eq(s.scenarios.orgId, org.id));

  const t0 = new Date("2025-07-01");
  const lines: PriceLine[] = [
    { skuId: "claude-sonnet-4", meterKey: "input_tokens", unitPrice: 2.5 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-sonnet-4", meterKey: "output_tokens", unitPrice: 12 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-haiku-3.5", meterKey: "input_tokens", unitPrice: 0.8 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-haiku-3.5", meterKey: "output_tokens", unitPrice: 4 / 1e6, effectiveFrom: t0, effectiveTo: null },
  ];

  const baselineRoutes: RouteSplit[] = [
    { skuId: "claude-sonnet-4", share: 1, avgInputTokens: 1800, avgOutputTokens: 420 },
  ];
  const targetRoutes: RouteSplit[] = [
    { skuId: "claude-haiku-3.5", share: 0.8, avgInputTokens: 1800, avgOutputTokens: 420, verbosityMultiplier: 1.05 },
    { skuId: "claude-sonnet-4", share: 0.2, avgInputTokens: 1800, avgOutputTokens: 420 },
  ];

  // ~support_copilot monthly request volume from seed shape
  const monthlyRequests = 4200 * 30;
  const delta = modelSwitchDelta({
    requests: monthlyRequests,
    baselineRoutes,
    targetRoutes,
    priceLines: lines,
    at: new Date(),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Scenarios</h1>
        <p className="muted mt-1">Named overrides on drivers, prices, routing, and commitments</p>
      </div>

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">Workspace</h2>
        <DataTable
          columns={[
            { key: "name", label: "Scenario" },
            { key: "status", label: "Status" },
            { key: "horizon", label: "Horizon" },
            { key: "overrides", label: "Overrides", align: "right" },
          ]}
          rows={scenarios.map((sc) => ({
            name: (
              <div>
                <div>{sc.name}</div>
                <div className="muted text-[11px]">{sc.description}</div>
              </div>
            ),
            status: sc.status,
            horizon: `${sc.horizonMonths} mo`,
            overrides: overrides.filter((o) => o.scenarioId === sc.id).length,
          }))}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">Baseline vs model-switch (monthly)</h2>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="muted text-[11px]">Baseline</div>
              <div className="kpi text-base">
                <Money value={delta.baselineCost} digits={0} />
              </div>
            </div>
            <div>
              <div className="muted text-[11px]">80/20 Haiku</div>
              <div className="kpi text-base">
                <Money value={delta.targetCost} digits={0} />
              </div>
            </div>
            <div>
              <div className="muted text-[11px]">Delta</div>
              <div className="kpi text-base" style={{ color: delta.delta < 0 ? "var(--accent)" : "var(--danger)" }}>
                <Money value={delta.delta} digits={0} />
              </div>
              <div className="muted text-[11px]">{(delta.deltaPct * 100).toFixed(1)}%</div>
            </div>
          </div>
          <p className="muted mt-3 text-[12px]">
            Explainable: same request volume, Haiku price card on 80% of routes, Sonnet on 20%,
            verbosity ×1.05 on Haiku outputs. Quality/latency are user-recorded assumptions — see
            Model Switch.
          </p>
        </div>
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">Override payloads</h2>
          <pre
            className="mono overflow-auto p-2 text-[11px]"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", maxHeight: 280 }}
          >
            {JSON.stringify(
              overrides.map((o) => ({
                type: o.overrideType,
                payload: o.payload,
              })),
              null,
              2
            )}
          </pre>
        </div>
      </div>

      <CommitmentOptimizerPanel />
    </div>
  );
}
