import Link from "next/link";
import { getCurrentOrg, getDimensionNodes, getDimensionTypes } from "@/lib/queries/org";
import {
  getAllocationByConnector,
  getAllocationPct,
  getAllocationTrend,
  getUnallocatedClusters,
} from "@/lib/queries/allocation";
import { AllocationClient } from "./AllocationClient";
import { pct, usd } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

function MiniSpark({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span className="text-[11px]" style={{ color: "var(--muted)" }}>No trend yet</span>;
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
    <svg width={w} height={h} className="block" aria-hidden>
      <polyline
        fill="none"
        stroke="#2f5bd8"
        strokeWidth="1.5"
        points={pts}
      />
    </svg>
  );
}

export default async function AllocationPage() {
  const org = await getCurrentOrg();
  if (!org) {
    return (
      <EmptyState
        message="Open a workspace to fix unassigned spend."
        action={{ href: "/onboarding", label: "Open Workspaces" }}
      />
    );
  }

  const [clusters, pctRow, trend, byConnector, types, nodes] = await Promise.all([
    getUnallocatedClusters(org.id, 30),
    getAllocationPct(org.id, 30),
    getAllocationTrend(org.id, 30),
    getAllocationByConnector(org.id, 30),
    getDimensionTypes(org.id),
    getDimensionNodes(org.id),
  ]);

  const unassignedSpend = clusters.reduce((a, c) => a + c.spend, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="panel p-4">
          <div className="text-[12px]" style={{ color: "var(--muted)" }}>
            Spend with a team (30d)
          </div>
          <div className="kpi mt-1">{pct(pctRow.allocatedPct, 0)}</div>
          <div className="mt-2">
            <MiniSpark values={trend.map((t) => t.allocatedPct)} />
          </div>
          <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
            Higher is better — fewer unassigned bills.
          </p>
        </div>
        <div className="panel p-4">
          <div className="text-[12px]" style={{ color: "var(--muted)" }}>
            Still unassigned
          </div>
          <div className="kpi mt-1">{usd(unassignedSpend)}</div>
          <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
            {clusters.length === 0
              ? "Nothing waiting."
              : `${clusters.length} group${clusters.length === 1 ? "" : "s"} to review below.`}
          </p>
          <p className="mt-2 text-[12px]">
            <Link href="/keys?unmapped=1" className="underline">
              Unmapped API keys →
            </Link>
          </p>
        </div>
        <div className="panel p-4">
          <div className="text-[12px]" style={{ color: "var(--muted)" }}>
            By vendor
          </div>
          {byConnector.length === 0 ? (
            <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
              No vendor-linked spend yet — import a CSV or sync a source.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-[13px]">
              {byConnector.map((c) => {
                const total = Number(c.total) || 1;
                const ap = Number(c.allocated) / total;
                return (
                  <li
                    key={c.connectorId}
                    className="flex items-center justify-between gap-2"
                  >
                    <span>{c.providerName}</span>
                    <span style={{ color: "var(--muted)" }}>
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
          dimensionTypeKey:
            types.find((t) => t.id === n.dimensionTypeId)?.key ?? "team",
        }))}
      />
    </div>
  );
}
