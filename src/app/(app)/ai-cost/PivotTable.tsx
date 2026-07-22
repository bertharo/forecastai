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

function nextMonthKey(key: string): string {
  const d = new Date(`${key}-01T00:00:00.000Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 7);
}

function compactTokens(n: number): string {
  if (n <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** Naive linear fit over the month series, clamped at zero. */
function projectNextMonth(node: PivotNode, months: string[]): number {
  const series = months.map((m) => node.spendByMonth[m] ?? 0);
  if (series.length < 2) return series[series.length - 1] ?? 0;
  const slope = (series[series.length - 1] - series[0]) / (series.length - 1);
  return Math.max(0, series[series.length - 1] + slope);
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

/** Keeps nodes whose name matches, or that contain a matching descendant. */
function filterTree(nodes: PivotNode[], q: string): PivotNode[] {
  const out: PivotNode[] = [];
  for (const node of nodes) {
    const selfMatch = node.name.toLowerCase().includes(q);
    const kids = filterTree(node.children, q);
    if (selfMatch) out.push(node);
    else if (kids.length > 0) out.push({ ...node, children: kids });
  }
  return out;
}

function maxDepth(nodes: PivotNode[], depth = 1): number {
  let max = depth;
  for (const n of nodes) {
    if (n.children.length > 0) max = Math.max(max, maxDepth(n.children, depth + 1));
  }
  return max;
}

export function PivotTable({ pivot }: { pivot: AiCostPivot }) {
  const router = useRouter();
  const params = useSearchParams();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? filterTree(pivot.rows, q) : pivot.rows),
    [pivot.rows, q]
  );
  const expandable = useMemo(() => allPathsWithChildren(visible), [visible]);
  const rows = useMemo(
    () => flatten(visible, 0, q ? new Set(expandable) : expanded, []),
    [visible, expanded, expandable, q]
  );
  const projLabel = monthLabel(nextMonthKey(pivot.months[pivot.months.length - 1]));

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

  function downloadCsv() {
    const depth = maxDepth(pivot.rows);
    const esc = (v: string) =>
      /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const header = [
      ...Array.from({ length: depth }, (_, i) => `Level ${i + 1}`),
      ...pivot.months,
      "Total",
      "Pct of total",
      "Users",
      "Tokens",
      "Merged PRs",
    ];
    const lines = [header.map(esc).join(",")];
    const walk = (nodes: PivotNode[], ancestors: string[]) => {
      for (const n of nodes) {
        const levels = [...ancestors, n.name];
        lines.push(
          [
            ...Array.from({ length: depth }, (_, i) => levels[i] ?? ""),
            ...pivot.months.map((m) => (n.spendByMonth[m] ?? 0).toFixed(2)),
            n.spend.toFixed(2),
            pivot.totalSpend
              ? ((n.spend / pivot.totalSpend) * 100).toFixed(1)
              : "0",
            String(n.users),
            String(Math.round(n.tokens)),
            String(n.mergedPrs),
          ]
            .map(esc)
            .join(",")
        );
        walk(n.children, levels);
      }
    };
    walk(pivot.rows, []);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ai-cost-${pivot.family.base}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
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
        <input
          className="select max-w-[200px]"
          placeholder="Search org…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="flex-1" />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setExpanded(new Set(allPathsWithChildren(pivot.rows)))}
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
        <button type="button" className="btn btn-ghost" onClick={downloadCsv}>
          Download CSV
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
            <th className="text-right">Tokens</th>
            <th className="text-right">PRs</th>
            <th className="text-right">$ / PR</th>
            <th className="text-right">Proj {projLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ node, depth }) => {
            const hasKids = node.children.length > 0;
            const pctOfTotal = pivot.totalSpend
              ? (node.spend / pivot.totalSpend) * 100
              : 0;
            const projected = projectNextMonth(node, pivot.months);
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
                    <span aria-hidden className="mono inline-block w-4 text-[11px]">
                      {hasKids ? (expanded.has(node.path) || q ? "▾" : "▸") : ""}
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
                <td className="mono muted text-right">{compactTokens(node.tokens)}</td>
                <td className="muted text-right">{node.mergedPrs || "—"}</td>
                <td className="mono muted text-right">
                  {node.mergedPrs ? usd(node.spend / node.mergedPrs) : "—"}
                </td>
                <td className="mono muted text-right">{usd(projected)}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7 + pivot.months.length} className="muted">
                No org matches “{query}”.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="muted text-[11px]">
        Rows come from your uploaded people file&apos;s{" "}
        {pivot.family.displayName.toLowerCase()} columns — no mapping needed.
        Unallocated rows are spend from people without a value at that level.
        Proj {projLabel}{" "}extends each row&apos;s monthly trend one month.
      </p>
    </div>
  );
}
