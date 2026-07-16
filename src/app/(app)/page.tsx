import { Suspense } from "react";
import { DataTable } from "@/components/DataTable";
import { SliceFilter } from "@/components/SliceFilter";
import { StackedSpend } from "@/components/charts/StackedSpend";
import { getDemoOrg, getDimensionNodes, getDimensionTypes } from "@/lib/queries/org";
import { getSeatUtilization, getSpendSummary } from "@/lib/queries/spend";
import { pct, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SpendPage({
  searchParams,
}: {
  searchParams: Promise<{ dim?: string; node?: string }>;
}) {
  try {
    const sp = await searchParams;
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

    const dayMap = new Map<string, Record<string, string | number>>();
    const providerKeys = new Set<string>();
    for (const row of summary.daily) {
      const day = String(row.day);
      providerKeys.add(row.provider);
      const cur = dayMap.get(day) ?? { day };
      cur[row.provider] = Number(row.effective);
      dayMap.set(day, cur);
    }
    const keys = [...providerKeys];
    const stacked = [...dayMap.values()]
      .sort((a, b) => String(a.day).localeCompare(String(b.day)))
      .map((row) => {
        const out: Record<string, string | number> = { day: String(row.day) };
        for (const k of keys) out[k] = Number(row[k] ?? 0);
        return out;
      });

    const sliceTypes = types.map((t) => ({
      id: t.id,
      key: t.key,
      displayName: t.displayName,
    }));
    const sliceNodes = nodes.map((n) => ({
      id: n.id,
      key: n.key,
      displayName: n.displayName,
      dimensionTypeId: n.dimensionTypeId,
    }));

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Spend</h1>
            <p className="muted mt-1">Run rate, MTD vs budget, allocation health</p>
          </div>
          <Suspense fallback={<div className="muted text-[12px]">Loading filters…</div>}>
            <SliceFilter types={sliceTypes} nodes={sliceNodes} />
          </Suspense>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="panel p-3">
            <div className="muted text-[11px] uppercase tracking-wide">MTD effective</div>
            <div className="kpi mt-1 mono">{usd(summary.mtd)}</div>
          </div>
          <div className="panel p-3">
            <div className="muted text-[11px] uppercase tracking-wide">30d run rate (mo)</div>
            <div className="kpi mt-1 mono">{usd(summary.runRate)}</div>
          </div>
          <div className="panel p-3">
            <div className="muted text-[11px] uppercase tracking-wide">Budget used</div>
            <div className="kpi mt-1">
              {summary.budget ? pct(summary.budget.mtdPct, 0) : "—"}
            </div>
            {summary.budget && (
              <div className="muted mt-1 text-[11px] mono">of {usd(summary.budget.amount)}</div>
            )}
          </div>
          <div className="panel p-3">
            <div className="muted text-[11px] uppercase tracking-wide">Allocated</div>
            <div className="kpi mt-1">{pct(summary.allocatedPct, 0)}</div>
          </div>
        </div>

        <div className="panel p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Spend by provider (60d)</h2>
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
                effective: usd(r.effective),
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
                effective: usd(r.effective),
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
                effective: usd(r.effective),
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
                day: String(a.day),
                amount: usd(a.amount),
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
              asOf: String(r.asOf),
              purchased: String(r.purchased),
              active: String(r.active),
              heavy: String(r.heavy),
              util: pct(r.active / Math.max(1, r.purchased), 0),
            }))}
          />
          <p className="muted mt-2 text-[12px]">
            Paying for 180 seats while ~90 are active — fastest ROI story in the product.
          </p>
        </div>
      </div>
    );
  } catch (err) {
    console.error("[spend] render failed", err);
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="panel space-y-2 p-4">
        <h1 className="page-title">Spend unavailable</h1>
        <p className="muted text-[13px]">
          Could not load spend data. Check Postgres (`brew services start postgresql@16`) and run{" "}
          <span className="mono">npm run db:setup</span>.
        </p>
        <pre
          className="mono overflow-auto p-2 text-[11px]"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        >
          {message}
        </pre>
      </div>
    );
  }
}
