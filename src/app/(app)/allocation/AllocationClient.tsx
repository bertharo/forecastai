"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { pct, usd } from "@/lib/format";

type Cluster = {
  id: string;
  spend: number;
  count: number;
  providerKey: string | null;
  providerName: string | null;
  model: string | null;
  feature: string | null;
  apiKey: string | null;
  source: string | null;
  environment: string | null;
  suggestedMatch: Record<string, string>;
};

type NodeOpt = {
  id: string;
  key: string;
  displayName: string;
  dimensionTypeKey: string;
};

type TypeOpt = { key: string; displayName: string };

export function AllocationClient({
  clusters,
  nodes,
  types,
  allocatedPct,
}: {
  clusters: Cluster[];
  nodes: NodeOpt[];
  types: TypeOpt[];
  allocatedPct: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    eventsWouldTouch?: number;
    spendWouldAllocate?: number;
    allocatedPctBefore?: number;
    allocatedPctAfter?: number;
    deltaPct?: number;
  } | null>(null);
  const [assignType, setAssignType] = useState(types[0]?.key ?? "team");
  const [assignNodeKey, setAssignNodeKey] = useState("");
  const [ruleName, setRuleName] = useState("");

  const nodeOptions = useMemo(
    () => nodes.filter((n) => n.dimensionTypeKey === assignType),
    [nodes, assignType]
  );

  const selectedClusters = clusters.filter((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === clusters.length) setSelected(new Set());
    else setSelected(new Set(clusters.map((c) => c.id)));
  }

  async function assignOnce() {
    if (!assignNodeKey || selectedClusters.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const c of selectedClusters) {
        const res = await fetch("/api/allocation/assign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            match: c.suggestedMatch,
            set: { [assignType]: assignNodeKey },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Assign failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function previewRule() {
    if (!assignNodeKey || selectedClusters.length === 0) return;
    const c = selectedClusters[0];
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/allocation/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preview: true,
          name: ruleName || `Rule from ${c.feature || c.providerKey || "cluster"}`,
          match: c.suggestedMatch,
          set: { [assignType]: assignNodeKey },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyRule() {
    if (!assignNodeKey || selectedClusters.length === 0) return;
    const c = selectedClusters[0];
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/allocation/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apply: true,
          name: ruleName || `Rule from ${c.feature || c.providerKey || "cluster"}`,
          match: c.suggestedMatch,
          set: { [assignType]: assignNodeKey },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply failed");
      setPreview(data);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="muted text-[11px] uppercase tracking-wide">
              Assign to
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              <select
                className="select"
                value={assignType}
                onChange={(e) => {
                  setAssignType(e.target.value);
                  setAssignNodeKey("");
                }}
              >
                {types.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.displayName}
                  </option>
                ))}
              </select>
              <select
                className="select"
                value={assignNodeKey}
                onChange={(e) => setAssignNodeKey(e.target.value)}
              >
                <option value="">Select node…</option>
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.key}>
                    {n.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="text-[12px]">
            Rule name
            <input
              className="select mt-1 block"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || !assignNodeKey || selected.size === 0}
            onClick={() => void assignOnce()}
          >
            Assign once
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !assignNodeKey || selected.size === 0}
            onClick={() => void previewRule()}
          >
            Preview rule
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !assignNodeKey || selected.size === 0}
            onClick={() => void applyRule()}
          >
            Create rule + apply
          </button>
        </div>
        {preview && (
          <p className="text-[12px]">
            {preview.eventsWouldTouch != null && (
              <>
                Would touch {preview.eventsWouldTouch} rows (
                {usd(preview.spendWouldAllocate ?? 0)}).{" "}
              </>
            )}
            Allocated {pct(preview.allocatedPctBefore ?? allocatedPct, 1)} →{" "}
            {pct(preview.allocatedPctAfter ?? allocatedPct, 1)}
            {preview.deltaPct != null && (
              <> (Δ {pct(preview.deltaPct, 1)})</>
            )}
            . Confirm with <strong>Create rule + apply</strong> to persist.
          </p>
        )}
        {error && (
          <p className="text-[12px]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <p className="muted text-[11px]">
          {selected.size} cluster(s) selected · org allocated{" "}
          {pct(allocatedPct, 0)}
        </p>
      </div>

      <div className="panel overflow-x-auto p-3">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr style={{ color: "var(--muted)" }}>
              <th className="pb-2 pr-2">
                <input
                  type="checkbox"
                  checked={
                    clusters.length > 0 && selected.size === clusters.length
                  }
                  onChange={toggleAll}
                />
              </th>
              <th className="pb-2 pr-2">Spend</th>
              <th className="pb-2 pr-2">Rows</th>
              <th className="pb-2 pr-2">Provider</th>
              <th className="pb-2 pr-2">Model</th>
              <th className="pb-2 pr-2">Feature</th>
              <th className="pb-2 pr-2">API key</th>
              <th className="pb-2 pr-2">Source</th>
              <th className="pb-2">Env</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => (
              <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                </td>
                <td className="mono py-2 pr-2">{usd(c.spend)}</td>
                <td className="mono py-2 pr-2">{c.count}</td>
                <td className="py-2 pr-2">{c.providerName ?? "—"}</td>
                <td className="mono py-2 pr-2">{c.model ?? "—"}</td>
                <td className="mono py-2 pr-2">{c.feature ?? "—"}</td>
                <td className="mono py-2 pr-2">{c.apiKey ?? "—"}</td>
                <td className="mono py-2 pr-2">{c.source ?? "—"}</td>
                <td className="mono py-2">{c.environment ?? "—"}</td>
              </tr>
            ))}
            {clusters.length === 0 && (
              <tr>
                <td colSpan={9} className="muted py-4">
                  No unallocated spend in the last 30 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
