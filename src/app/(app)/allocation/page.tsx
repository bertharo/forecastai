import { getCurrentOrg, getDimensionNodes, getDimensionTypes } from "@/lib/queries/org";
import {
  getAllocationByConnector,
  getAllocationPct,
  getAllocationTrend,
  getUnallocatedClusters,
} from "@/lib/queries/allocation";
import { AllocationClient } from "./AllocationClient";
import { pct, usd } from "@/lib/format";

export const dynamic = "force-dynamic";

function MiniSpark({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span className="muted text-[11px]">No trend</span>;
  }
  const w = 120;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="block">
      <polyline
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        points={pts}
      />
    </svg>
  );
}

export default async function AllocationPage() {
  const org = await getCurrentOrg();
  if (!org) {
    return <p className="muted">No org — run npm run db:seed</p>;
  }

  const [clusters, pctRow, trend, byConnector, types, nodes] = await Promise.all([
    getUnallocatedClusters(org.id, 30),
    getAllocationPct(org.id, 30),
    getAllocationTrend(org.id, 30),
    getAllocationByConnector(org.id, 30),
    getDimensionTypes(org.id),
    getDimensionNodes(org.id),
  ]);

  const typeById = new Map(types.map((t) => [t.id, t]));

  return (
    <div className="space-y-5">
      <div className="soft-card" style={{ background: "#fff1e8" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          Alerts
        </div>
        <p className="mt-2 max-w-2xl text-[16px] font-medium leading-snug">
          Unallocated spend and threshold alerts — assign clusters or create rules that apply
          retroactively.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="panel p-3">
          <div className="muted text-[11px] uppercase tracking-wide">
            Org allocated (30d)
          </div>
          <div className="kpi mt-1">{pct(pctRow.allocatedPct, 0)}</div>
          <div className="mt-2">
            <MiniSpark values={trend.map((t) => t.allocatedPct)} />
          </div>
        </div>
        <div className="panel p-3 md:col-span-2">
          <div className="muted mb-2 text-[11px] uppercase tracking-wide">
            By connector
          </div>
          {byConnector.length === 0 ? (
            <p className="muted text-[12px]">
              No connector-linked cost yet — import or sync to populate.
            </p>
          ) : (
            <ul className="space-y-1 text-[12px]">
              {byConnector.map((c) => {
                const total = Number(c.total) || 1;
                const ap = Number(c.allocated) / total;
                return (
                  <li
                    key={c.connectorId}
                    className="flex items-center justify-between gap-2"
                  >
                    <span>{c.providerName}</span>
                    <span className="mono muted">
                      {pct(ap, 0)} · {usd(Number(c.spend))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <AllocationClient
        clusters={clusters}
        allocatedPct={pctRow.allocatedPct}
        types={types.map((t) => ({ key: t.key, displayName: t.displayName }))}
        nodes={nodes.map((n) => ({
          id: n.id,
          key: n.key,
          displayName: n.displayName,
          dimensionTypeKey: typeById.get(n.dimensionTypeId)?.key ?? "",
        }))}
      />
    </div>
  );
}
