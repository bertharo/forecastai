"use client";

import { useMemo, useState } from "react";
import { buildTree, flattenTree, type DimNode } from "@/lib/dimensions/tree";

export function TreePicker({
  nodes,
  value,
  onChange,
  placeholder = "All nodes",
}: {
  nodes: DimNode[];
  value: string;
  onChange: (nodeId: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const roots = useMemo(() => buildTree(nodes), [nodes]);
  const flat = useMemo(() => flattenTree(roots), [roots]);
  const selected = nodes.find((n) => n.id === value);
  const childrenOf = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const n of flat) {
      if (n.parentId) m.set(n.parentId, true);
    }
    return m;
  }, [flat]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term) {
      return flat.filter(
        (n) =>
          n.displayName.toLowerCase().includes(term) ||
          n.key.toLowerCase().includes(term) ||
          (n.costCenterCode ?? "").toLowerCase().includes(term)
      );
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return flat.filter((n) => {
      let cur = n.parentId ? byId.get(n.parentId) : undefined;
      while (cur) {
        if (!expanded.has(cur.id)) return false;
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return true;
    });
  }, [expanded, flat, nodes, q]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="select text-left"
        style={{ minWidth: 160 }}
        onClick={() => setOpen((o) => !o)}
      >
        {selected ? selected.displayName : placeholder}
      </button>
      {open && (
        <div
          className="absolute z-20 mt-1 w-72 rounded border p-2 shadow-lg"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <input
            className="select mb-2 w-full text-[12px]"
            placeholder="Search nodes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            className="mb-1 block w-full rounded px-2 py-1 text-left text-[12px]"
            style={{ color: "var(--muted)" }}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            {placeholder}
          </button>
          <ul className="max-h-64 overflow-auto text-[12px]">
            {visible.map((n) => {
              const hasChildren = childrenOf.has(n.id);
              const isExp = expanded.has(n.id);
              return (
                <li key={n.id} style={{ paddingLeft: n.depth * 12 }}>
                  <div className="flex items-center gap-1">
                    {hasChildren ? (
                      <button
                        type="button"
                        className="mono w-4 text-[10px]"
                        style={{ color: "var(--muted)" }}
                        onClick={() => toggleExpand(n.id)}
                        aria-label={isExp ? "Collapse" : "Expand"}
                      >
                        {isExp ? "▾" : "▸"}
                      </button>
                    ) : (
                      <span className="w-4" />
                    )}
                    <button
                      type="button"
                      className="flex-1 rounded px-1 py-0.5 text-left"
                      style={{
                        background:
                          n.id === value ? "var(--accent-dim)" : "transparent",
                      }}
                      onClick={() => {
                        onChange(n.id);
                        setOpen(false);
                      }}
                    >
                      {n.displayName}
                      {n.costCenterCode ? (
                        <span className="muted ml-1 mono text-[10px]">
                          {n.costCenterCode}
                        </span>
                      ) : null}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
