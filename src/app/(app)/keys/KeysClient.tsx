"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usd } from "@/lib/format";

type KeyRow = {
  id: string;
  kind: "api_key" | "workspace";
  externalId: string;
  displayName: string | null;
  dimensionNodeId: string | null;
  isServiceAccount: boolean;
  serviceLabel: string | null;
  spend30d: number;
  nodeName: string | null;
  mapped: boolean;
};

type NodeOpt = { id: string; key: string; displayName: string; path: string };

export function KeysClient({
  initialKeys,
  nodes,
  unmappedOnly,
}: {
  initialKeys: KeyRow[];
  nodes: NodeOpt[];
  unmappedOnly: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        dimensionNodeId: string;
        isServiceAccount: boolean;
        serviceLabel: string;
      }
    >
  >(() =>
    Object.fromEntries(
      initialKeys.map((k) => [
        k.id,
        {
          dimensionNodeId: k.dimensionNodeId ?? "",
          isServiceAccount: k.isServiceAccount,
          serviceLabel: k.serviceLabel ?? "",
        },
      ])
    )
  );

  const teamNodes = useMemo(
    () =>
      nodes.filter(
        (n) =>
          n.path.split("/").filter(Boolean).length >= 1 ||
          n.key.includes("team") ||
          true
      ),
    [nodes]
  );

  async function save(id: string) {
    const d = drafts[id];
    if (!d) return;
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch("/api/keys", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          registryId: id,
          dimensionNodeId: d.dimensionNodeId || null,
          isServiceAccount: d.isServiceAccount,
          serviceLabel: d.serviceLabel || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      const touched = data.retro?.eventsTouched ?? 0;
      setMsg(
        touched
          ? `Saved · re-allocated ${touched} historical rows`
          : "Saved"
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {msg && <p className="muted text-[13px]">{msg}</p>}
      <div className="flex flex-wrap gap-2 text-[13px]">
        <a
          className={!unmappedOnly ? "btn" : "btn btn-ghost"}
          href="/keys"
        >
          All keys
        </a>
        <a
          className={unmappedOnly ? "btn" : "btn btn-ghost"}
          href="/keys?unmapped=1"
        >
          Needs mapping
        </a>
      </div>

      <div className="panel overflow-x-auto p-0">
        <table className="data">
          <thead>
            <tr>
              <th>Key / workspace</th>
              <th className="text-right">30d spend</th>
              <th>Assign to</th>
              <th>Service account</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {initialKeys.map((k) => {
              const d = drafts[k.id] ?? {
                dimensionNodeId: "",
                isServiceAccount: false,
                serviceLabel: "",
              };
              return (
                <tr key={k.id}>
                  <td>
                    <div className="font-medium">
                      {k.displayName || k.externalId}
                    </div>
                    <div className="muted text-[11px]">
                      {k.kind === "api_key" ? "API key" : "Workspace"} ·{" "}
                      <span className="mono">{k.externalId}</span>
                      {!k.mapped && (
                        <span
                          className="ml-2 badge"
                          style={{
                            color: "var(--warning)",
                            background: "rgba(232,132,58,0.12)",
                          }}
                        >
                          Unmapped
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="mono text-right font-semibold">
                    {usd(k.spend30d)}
                  </td>
                  <td>
                    <select
                      className="select text-[12px]"
                      value={d.dimensionNodeId}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [k.id]: { ...d, dimensionNodeId: e.target.value },
                        }))
                      }
                    >
                      <option value="">— Not mapped —</option>
                      {teamNodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.displayName} ({n.key})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label className="flex items-center gap-2 text-[12px]">
                      <input
                        type="checkbox"
                        checked={d.isServiceAccount}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [k.id]: {
                              ...d,
                              isServiceAccount: e.target.checked,
                            },
                          }))
                        }
                      />
                      Bot / agent
                    </label>
                    {d.isServiceAccount && (
                      <input
                        className="input mt-1 w-full text-[12px]"
                        placeholder="e.g. support-bot"
                        value={d.serviceLabel}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [k.id]: { ...d, serviceLabel: e.target.value },
                          }))
                        }
                      />
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      disabled={busyId === k.id}
                      onClick={() => void save(k.id)}
                    >
                      {busyId === k.id ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {initialKeys.length === 0 && (
              <tr>
                <td colSpan={5} className="muted p-4 text-[13px]">
                  {unmappedOnly
                    ? "All keys are mapped — nice."
                    : "No keys yet. Run an Anthropic sync under Sources — keys show up here automatically."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
