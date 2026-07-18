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
      <div className="soft-card space-y-3">
        <div>
          <div className="text-[13px] font-semibold">Put this spend on a team</div>
          <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
            Select one or more groups below, pick a team, then assign. “Remember” also
            fixes matching future spend.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[12px]" style={{ color: "var(--muted)" }}>
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
                <option value="">Pick a team…</option>
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.key}>
                    {n.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="text-[12px]">
            Nickname (optional)
            <input
              className="input mt-1 block"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="e.g. Shadow keys → Eng"
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
            className="btn btn-ghost"
            disabled={busy || !assignNodeKey || selected.size === 0}
            onClick={() => void previewRule()}
          >
            Preview
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !assignNodeKey || selected.size === 0}
            onClick={() => void applyRule()}
          >
            Assign & remember
          </button>
        </div>
        {preview && (
          <p className="text-[13px]">
            {preview.eventsWouldTouch != null && (
              <>
                Would cover {preview.eventsWouldTouch} rows (
                {usd(preview.spendWouldAllocate ?? 0)}).{" "}
              </>
            )}
            Attributed spend would go from{" "}
            {pct(preview.allocatedPctBefore ?? allocatedPct, 0)} →{" "}
            {pct(preview.allocatedPctAfter ?? allocatedPct, 0)}.
            {preview.deltaPct != null && (
              <> That’s {pct(Math.abs(preview.deltaPct), 0)} more covered.</>
            )}{" "}
            Tap <strong>Assign & remember</strong> to save.
          </p>
        )}
        {error && (
          <p className="text-[12px]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <p className="text-[12px]" style={{ color: "var(--muted)" }}>
          {selected.size} selected · {pct(allocatedPct, 0)} of spend already on a team
        </p>
      </div>

      <div className="soft-card overflow-x-auto">
        <table className="w-full text-left text-[13px]">
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
              <th className="pb-2 pr-2">Amount</th>
              <th className="pb-2 pr-2">Vendor</th>
              <th className="pb-2 pr-2">Model</th>
              <th className="pb-2 pr-2">Feature</th>
              <th className="pb-2 pr-2">API key</th>
              <th className="pb-2">Where from</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => (
              <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="py-2.5 pr-2">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                </td>
                <td className="py-2.5 pr-2 font-semibold">{usd(c.spend)}</td>
                <td className="py-2.5 pr-2">{c.providerName ?? "—"}</td>
                <td className="py-2.5 pr-2">{c.model ?? "—"}</td>
                <td className="py-2.5 pr-2">{c.feature ?? "—"}</td>
                <td className="py-2.5 pr-2 mono text-[12px]">{c.apiKey ?? "—"}</td>
                <td className="py-2.5 text-[12px]" style={{ color: "var(--muted)" }}>
                  {c.source ?? "—"}
                  {c.environment ? ` · ${c.environment}` : ""}
                </td>
              </tr>
            ))}
            {clusters.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4" style={{ color: "var(--muted)" }}>
                  Nothing unassigned in the last 30 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
