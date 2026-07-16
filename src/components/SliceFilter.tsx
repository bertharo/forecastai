"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function SliceFilter({
  types,
  nodes,
}: {
  types: { id: string; key: string; displayName: string }[];
  nodes: { id: string; key: string; displayName: string; dimensionTypeId: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const typeKey = params.get("dim") ?? "";
  const nodeId = params.get("node") ?? "";
  const selectedType = types.find((t) => t.key === typeKey);
  const filteredNodes = selectedType
    ? nodes.filter((n) => n.dimensionTypeId === selectedType.id)
    : [];

  function update(next: { dim?: string; node?: string }) {
    const sp = new URLSearchParams(params.toString());
    if (next.dim !== undefined) {
      if (next.dim) sp.set("dim", next.dim);
      else sp.delete("dim");
      sp.delete("node");
    }
    if (next.node !== undefined) {
      if (next.node) sp.set("node", next.node);
      else sp.delete("node");
    }
    router.push(`?${sp.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="muted text-[11px] uppercase tracking-wide">Slice</span>
      <select
        className="select"
        value={typeKey}
        onChange={(e) => update({ dim: e.target.value })}
      >
        <option value="">All org</option>
        {types.map((t) => (
          <option key={t.id} value={t.key}>
            {t.displayName}
          </option>
        ))}
      </select>
      {selectedType && (
        <select
          className="select"
          value={nodeId}
          onChange={(e) => update({ node: e.target.value })}
        >
          <option value="">All {selectedType.displayName}</option>
          {filteredNodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.displayName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
