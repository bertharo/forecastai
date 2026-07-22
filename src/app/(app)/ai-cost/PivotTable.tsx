"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usd } from "@/lib/format";
import type { AiCostPivot, PivotNode } from "@/lib/queries/ai-cost-pivot";

function monthLabel(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${key}-01T00:00:00.000Z`));
}

type FlatRow = { node: PivotNode; depth: number };

function flatten(
  nodes: PivotNode[],
  depth: number,
  expanded: Set<string>,
  out: FlatRow[]
): FlatRow[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children.length > 0 && expanded.has(node.path)) {
      flatten(node.children, depth + 1, expanded, out);
    }
  }
  return out;
}

function allPathsWithChildren(nodes: PivotNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children.length > 0) {
      out.push(n.path);
      allPathsWithChildren(n.children, out);
    }
  }
  return out;
}

export function PivotTable({ pivot }: { pivot: AiCostPivot }) {
  const router = useRouter();
  const params = useSearchParams();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () => flatten(pivot.rows, 0, expanded, []),
    [pivot.rows, expanded]
  );
  const expandable = useMemo(() => allPathsWithChildren(pivot.rows), [pivot.rows]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function pickFamily(base: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set("hier", base);
    router.push(`/ai-cost?${sp.toString()}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {pivot.familyOptions.map((f) => (
          <button
            key={f.base}
            type="button"
            className={f.base === pivot.family.base ? "btn" : "btn btn-ghost"}
            onClick={() => pickFamily(f.base)}
          >
            {f.displayName}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setExpanded(new Set(expandable))}
        >
          Expand all
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setExpanded(new Set())}
        >
          Collapse all
        </button>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>{pivot.family.displayName}</th>
            {pivot.months.map((m) => (
              <th key={m} className="text-right">
                {monthLabel(m)}
              </th>
            ))}
            <th className="text-right">Total</th>
            <th className="text-right">% of total</th>
            <th className="text-right">Users</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, depth }) => {
            const hasKids = node.children.length > 0;
            const pctOfTotal = pivot.totalSpend
              ? (node.spend / pivot.totalSpend) * 100
              : 0;
            return (
              <tr
                key={node.path}
                onClick={hasKids ? () => toggle(node.path) : undefined}
                style={hasKids ? { cursor: "pointer" } : undefined}
              >
                <td>
                  <span
                    className={node.synthetic ? "muted" : hasKids ? "font-medium" : ""}
                    style={{ paddingLeft: depth * 20 }}
                  >
                    <span
                      aria-hidden
                      className="mono inline-block w-4 text-[11px]"
                    >
                      {hasKids ? (expanded.has(node.path) ? "▾" : "▸") : ""}
                    </span>
                    {node.name}
                  </span>
                </td>
                {pivot.months.map((m) => (
                  <td
                    key={m}
                    className={`mono text-right ${node.synthetic ? "muted" : ""}`}
                  >
                    {node.spendByMonth[m] ? usd(node.spendByMonth[m]) : "—"}
                  </td>
                ))}
                <td
                  className={`mono text-right ${
                    node.synthetic ? "muted" : "font-medium"
                  }`}
                >
                  {usd(node.spend)}
                </td>
                <td className="muted text-right">{pctOfTotal.toFixed(0)}%</td>
                <td className="muted text-right">{node.users}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted text-[11px]">
        Rows come from your uploaded people file&apos;s{" "}
        {pivot.family.displayName.toLowerCase()} columns — no mapping needed.
        Unallocated rows are spend from people without a value at that level.
      </p>
    </div>
  );
}
