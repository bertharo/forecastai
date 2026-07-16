"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PreviewNode = {
  key: string;
  displayName: string;
  dimensionType: string;
  path: string;
  depth: number;
  status: string;
  costCenterCode: string | null;
};

export function OrgStructureImport() {
  const router = useRouter();
  const [csv, setCsv] = useState(
    [
      "node_name,parent_name,dimension_type,cost_center_code,owner_email,node_key",
      "Research,,business_unit,,,research",
      "Applied Research,Research,department,,,applied-research",
      "ML Eval,Applied Research,team,CC-410,ml@example.com,ml-eval",
    ].join("\n")
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    ok: boolean;
    errors: string[];
    nodes: PreviewNode[];
    adapterContract?: string;
  } | null>(null);
  const [showContract, setShowContract] = useState(false);

  async function run(action: "preview" | "import") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org-structure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, csv }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPreview(data);
        throw new Error(data.error || "Request failed");
      }
      setPreview(data);
      if (action === "import") router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel space-y-3 p-4">
      <div>
        <h2 className="text-sm font-medium">Org structure CSV</h2>
        <p className="muted mt-1 text-[12px]">
          Columns:{" "}
          <span className="mono">
            node_name, parent_name, dimension_type, cost_center_code, owner_email
          </span>
          . Validates cycles/orphans and previews the tree before commit.
        </p>
      </div>
      <textarea
        className="select mono w-full text-[11px]"
        rows={8}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run("preview")}
        >
          Preview tree
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !preview?.ok}
          onClick={() => void run("import")}
        >
          Commit import
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setShowContract((v) => !v)}
        >
          {showContract ? "Hide" : "Show"} IdP adapter contract
        </button>
      </div>
      {error && (
        <p className="text-[12px]" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {preview?.errors?.length ? (
        <ul className="text-[12px]" style={{ color: "var(--warning)" }}>
          {preview.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {preview?.nodes?.length ? (
        <ul className="mono max-h-48 overflow-auto text-[11px]">
          {preview.nodes.map((n) => (
            <li key={n.path} style={{ paddingLeft: n.depth * 12 }}>
              {n.displayName}{" "}
              <span className="muted">
                ({n.dimensionType}) {n.status}
                {n.costCenterCode ? ` · ${n.costCenterCode}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {showContract && (
        <pre
          className="mono overflow-auto p-2 text-[10px]"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        >
          {preview?.adapterContract ||
            "POST /api/org-structure GET returns adapterContract"}
        </pre>
      )}
    </div>
  );
}
