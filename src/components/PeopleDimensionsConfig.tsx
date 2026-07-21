"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PeopleDimensionColumnConfig } from "@/db/schema";

type ConfigResponse = {
  config: {
    columns: PeopleDimensionColumnConfig[];
    profiledAt: string | null;
    rowCount: number;
  };
};

export function PeopleDimensionsConfig() {
  const router = useRouter();
  const [columns, setColumns] = useState<PeopleDimensionColumnConfig[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const res = await fetch("/api/roster/dimensions");
    const data = (await res.json()) as ConfigResponse & { error?: string };
    if (!res.ok) {
      setMsg(data.error || "Could not load dimensions");
      return;
    }
    setColumns(data.config.columns);
    setRowCount(data.config.rowCount);
    setLoaded(true);
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(next: PeopleDimensionColumnConfig[]) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/roster/dimensions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          columns: next.map((c) => ({
            key: c.key,
            displayName: c.displayName,
            enabled: c.enabled,
            role: c.role,
          })),
        }),
      });
      const data = (await res.json()) as ConfigResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Save failed");
      setColumns(data.config.columns);
      setMsg("Saved — Home rollups updated");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function updateLocal(key: string, patch: Partial<PeopleDimensionColumnConfig>) {
    setColumns((cols) =>
      cols.map((c) => {
        if (c.key !== key) {
          // Clear conflicting roles
          if (
            patch.role &&
            (patch.role === "primary" || patch.role === "secondary") &&
            c.role === patch.role
          ) {
            return { ...c, role: null };
          }
          return c;
        }
        return { ...c, ...patch };
      })
    );
  }

  if (!loaded) {
    return (
      <div id="org-dimensions" className="panel p-4">
        <div className="text-[15px] font-semibold">Org dimensions</div>
        <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
          Loading…
        </p>
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div id="org-dimensions" className="panel p-4">
        <div className="text-[15px] font-semibold">Org dimensions</div>
        <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
          Import a people CSV first. Every attribute column becomes a candidate
          dimension you can enable for Home rollups.
        </p>
      </div>
    );
  }

  return (
    <div id="org-dimensions" className="panel p-4 space-y-3">
      <div>
        <div className="text-[15px] font-semibold">Org dimensions</div>
        <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
          Enable attributes from your people CSV ({rowCount} people). Primary and
          secondary control Home card order only. Renames update rollups without
          re-import.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr style={{ color: "var(--muted)" }}>
              <th className="py-1 pr-2 font-medium">On</th>
              <th className="py-1 pr-2 font-medium">Display name</th>
              <th className="py-1 pr-2 font-medium">Source column</th>
              <th className="py-1 pr-2 font-medium">Role</th>
              <th className="py-1 pr-2 font-medium">Suggestion</th>
              <th className="py-1 font-medium">Distinct</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => {
              const eligible = c.suggestion === "dimension";
              return (
                <tr key={c.key} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      disabled={!eligible || busy}
                      title={
                        eligible
                          ? "Enable for Home rollups"
                          : `${c.suggestion} columns cannot group`
                      }
                      onChange={(e) =>
                        updateLocal(c.key, {
                          enabled: e.target.checked,
                          role: e.target.checked ? c.role : null,
                        })
                      }
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="input w-40 text-[13px]"
                      value={c.displayName}
                      disabled={busy}
                      onChange={(e) =>
                        updateLocal(c.key, { displayName: e.target.value })
                      }
                    />
                  </td>
                  <td className="py-2 pr-2 font-mono text-[12px]">{c.sourceColumn}</td>
                  <td className="py-2 pr-2">
                    <select
                      className="input text-[12px]"
                      value={c.role ?? ""}
                      disabled={!c.enabled || busy}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateLocal(c.key, {
                          role:
                            v === "primary" || v === "secondary"
                              ? v
                              : null,
                        });
                      }}
                    >
                      <option value="">—</option>
                      <option value="primary">Primary</option>
                      <option value="secondary">Secondary</option>
                    </select>
                  </td>
                  <td className="py-2 pr-2" style={{ color: "var(--muted)" }}>
                    {c.suggestion}
                    {c.sampleValues.length > 0
                      ? ` · e.g. ${c.sampleValues.slice(0, 2).join(", ")}`
                      : ""}
                  </td>
                  <td className="py-2">{c.distinctCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => void save(columns)}
      >
        {busy ? "Saving…" : "Save dimensions"}
      </button>
      {msg && (
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
