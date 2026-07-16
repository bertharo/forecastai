import { Suspense } from "react";
import { Money } from "@/components/Money";
import { DataTable } from "@/components/DataTable";
import { SliceFilter } from "@/components/SliceFilter";
import { StackedSpend } from "@/components/charts/StackedSpend";
import { assertDb } from "@/db";
import { getDemoOrg, getDimensionNodes, getDimensionTypes } from "@/lib/queries/org";
import { getSeatUtilization, getSpendSummary } from "@/lib/queries/spend";
import { pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SpendPage({
  searchParams,
}: {
  searchParams: Promise<{ dim?: string; node?: string }>;
}) {
  const sp = await searchParams;
  await assertDb();
  const org = await getDemoOrg();
  if (!org) {
    return <p className="muted">No org — run npm run db:seed</p>;
  }

  const [types, nodes, summary, seats] = await Promise.all([
    getDimensionTypes(org.id),
    getDimensionNodes(org.id),
    getSpendSummary(org.id, sp.node),
    getSeatUtilization(org.id),
  ]);

  // Pivot daily by provider
  const dayMap = new Map<string, Record<string, number | string>>();
  const providerKeys = new Set<string>();
  for (const row of summary.daily) {
    providerKeys.add(row.provider);
    const cur = dayMap.get(row.day) ?? { day: row.day };
    cur[row.provider] = Number(row.effective);
    dayMap.set(row.day, cur);
  }
  const stacked = [...dayMap.values()].sort((a, b) =>
    String(a.day).localeCompare(String(b.day))
  );
  const keys = [...providerKeys];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Spend</h1>
          <p className="muted mt-1">Run rate, MTD vs budget, allocation health</p>
        </div>
        <Suspense fallback={null}>
          <SliceFilter types={types} nodes={nodes} />
        </Suspense>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "MTD effective", value: summary.mtd },
          { label: "30d run rate (mo)", value: summary.runRate },
          {
            label: "Budget used",
            value: summary.budget ? summary.budget.mtdPct : null,
            isPct: true,
            sub: summary.budget ? `of ${summary.budget.amount}` : undefined,
          },
          {
            label: "Allocated",
            value: summary.allocatedPct,
            isPct: true,
          },
        ].map((k) => (
          <div key={k.label} className="panel p-3">
            <div className="muted text-[11px] uppercase tracking-wide">{k.label}</div>
            <div className="kpi mt-1">
              {k.isPct ? (
                pct(Number(k.value ?? 0), 0)
              ) : (
                <Money value={Number(k.value ?? 0)} />
              )}
            </div>
            {k.sub && (
              <div className="muted mt-1 text-[11px]">
                of <Money value={Number(k.sub.replace("of ", "") || summary.budget?.amount || 0)} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="panel p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Spend by provider (60d)</h2>
          <span className="muted text-[11px]">Export via chart menu in production</span>
        </div>
        <StackedSpend data={stacked} keys={keys} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">By model / SKU</h2>
          <DataTable
            columns={[
              { key: "sku", label: "SKU" },
              { key: "effective", label: "30d effective", align: "right" },
            ]}
            rows={summary.bySku.map((r) => ({
              sku: r.sku,
              effective: <Money value={r.effective} />,
            }))}
          />
        </div>
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">By feature</h2>
          <DataTable
            columns={[
              { key: "feature", label: "Feature" },
              { key: "effective", label: "30d effective", align: "right" },
            ]}
            rows={summary.byFeature.map((r) => ({
              feature: r.feature,
              effective: <Money value={r.effective} />,
            }))}
          />
        </div>
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">By team</h2>
          <DataTable
            columns={[
              { key: "team", label: "Team" },
              { key: "effective", label: "30d effective", align: "right" },
            ]}
            rows={summary.byTeam.map((r) => ({
              team: r.team,
              effective: <Money value={r.effective} />,
            }))}
          />
        </div>
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">Anomalies vs 60d baseline</h2>
          <DataTable
            columns={[
              { key: "day", label: "Day" },
              { key: "amount", label: "Spend", align: "right" },
              { key: "vs", label: "vs mean", align: "right" },
            ]}
            rows={summary.anomalies.map((a) => ({
              day: a.day,
              amount: <Money value={a.amount} />,
              vs: `${a.vsBaseline.toFixed(1)}×`,
            }))}
          />
          {summary.anomalies.length === 0 && (
            <p className="muted mt-2 text-[12px]">No spikes &gt; 2× trailing mean</p>
          )}
        </div>
      </div>

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">Cursor seat utilization</h2>
        <DataTable
          columns={[
            { key: "asOf", label: "As of" },
            { key: "purchased", label: "Purchased", align: "right" },
            { key: "active", label: "Active", align: "right" },
            { key: "heavy", label: "Heavy", align: "right" },
            { key: "util", label: "Utilization", align: "right" },
          ]}
          rows={seats.map((r) => ({
            asOf: r.asOf,
            purchased: r.purchased,
            active: r.active,
            heavy: r.heavy,
            util: pct(r.active / r.purchased, 0),
          }))}
        />
        <p className="muted mt-2 text-[12px]">
          Paying for 180 seats while ~90 are active — fastest ROI story in the product.
        </p>
      </div>
    </div>
  );
}
