"use client";

import { useMemo, useState } from "react";
import { usd, formatCostPerMTokens } from "@/lib/format";

type Contributor = {
  contributorId: string;
  email: string | null;
  name: string | null;
  team: string | null;
  spend: number;
  tokens: number;
};

type SortKey = "name" | "team" | "spend" | "tokens" | "costPerMTokens";

const columns: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "name", label: "Name", align: "left" },
  { key: "team", label: "Team", align: "left" },
  { key: "spend", label: "Spend", align: "right" },
  { key: "tokens", label: "Tokens", align: "right" },
  { key: "costPerMTokens", label: "$ / M tokens", align: "right" },
];

const defaultDirection: Record<SortKey, "asc" | "desc"> = {
  name: "asc",
  team: "asc",
  spend: "desc",
  tokens: "desc",
  costPerMTokens: "desc",
};

function sortValue(c: Contributor, key: SortKey): string | number {
  switch (key) {
    case "name":
      return (c.name ?? c.email ?? "").toLowerCase();
    case "team":
      return (c.team ?? "").toLowerCase();
    case "spend":
      return c.spend;
    case "tokens":
      return c.tokens;
    case "costPerMTokens":
      return c.tokens > 0 ? (c.spend / c.tokens) * 1_000_000 : -1;
  }
}

export function ContributorTable({ contributors }: { contributors: Contributor[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(defaultDirection[key]);
    }
  }

  const sorted = useMemo(() => {
    const copy = [...contributors];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : (av as number) - (bv as number);
      return direction === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [contributors, sortKey, direction]);

  return (
    <table className="data">
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              className={col.align === "right" ? "text-right" : undefined}
            >
              <button
                type="button"
                className="inline-flex items-center gap-1"
                onClick={() => toggleSort(col.key)}
              >
                {col.label}
                {sortKey === col.key && (
                  <span aria-hidden>{direction === "asc" ? "▲" : "▼"}</span>
                )}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((c) => (
          <tr key={c.contributorId}>
            <td>
              <div className="font-medium">{c.name}</div>
              <div className="muted text-[11px]">{c.email}</div>
            </td>
            <td>{c.team ?? "—"}</td>
            <td className="mono text-right">{usd(c.spend)}</td>
            <td className="mono text-right">{Math.round(c.tokens).toLocaleString()}</td>
            <td className="mono text-right">
              {formatCostPerMTokens(c.spend, c.tokens)}
            </td>
          </tr>
        ))}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={5} className="muted">
              No contributor-attributed AI spend in this window.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
