"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IMPORT_TARGETS } from "@/lib/import/parse";
import { OrgStructureImport } from "@/components/OrgStructureImport";
import { RosterImport } from "@/components/RosterImport";

type Template = {
  id: string;
  name: string;
  sourceFormat: string;
  isSystem: boolean;
  columnMap: Record<string, string>;
  sampleHeaders: string[] | null;
};

type Batch = {
  id: string;
  fileName: string;
  status: string;
  rowsWritten: number;
  rowsSkipped: number;
  rowsErrored: number;
  createdAt: string;
};

export default function ImportPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [templateId, setTemplateId] = useState("");
  const [sourceKind, setSourceKind] = useState<"csv" | "jsonl" | "invoice">("csv");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ row: number; field?: string; message: string }[]>(
    []
  );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/import");
    const data = await res.json();
    setTemplates(data.templates ?? []);
    setBatches(data.batches ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFile = async (file: File) => {
    setMessage(null);
    setErrors([]);
    const text = await file.text();
    setFileName(file.name);
    setContent(text);
    const kind = file.name.endsWith(".jsonl")
      ? "jsonl"
      : sourceKind === "invoice"
        ? "invoice"
        : "csv";
    setSourceKind(kind);
    setBusy(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          fileName: file.name,
          content: text,
          sourceKind: kind,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "preview failed");
      const hdrs: string[] = data.headers ?? [];
      setHeaders(hdrs);
      setPreview(data.preview ?? []);
      setRowCount(data.rowCount ?? 0);
      // Prefer usage / DX templates over org-structure when headers look like spend
      const lower = new Set(hdrs.map((h) => h.toLowerCase()));
      const looksDx =
        lower.has("tool") && (lower.has("spend") || lower.has("cost")) && lower.has("day");
      const looksOrg =
        lower.has("node_name") &&
        (lower.has("parent_name") || lower.has("dimension_type"));
      const looksUsage =
        (lower.has("cost") || lower.has("cost_usd") || lower.has("amount")) &&
        (lower.has("model") || lower.has("tokens") || lower.has("created_at"));
      if (looksDx) {
        setMessage(
          "This looks like a DX AI metrics export — import it under Data & sources → Import DX CSV (not usage import)."
        );
      } else if (!looksOrg && looksUsage && templates.length) {
        const usageTpl =
          templates.find((t) => t.sourceFormat !== "org_structure" && t.sourceFormat !== "dx_ai_metrics") ??
          templates.find((t) => t.sourceFormat !== "org_structure");
        if (usageTpl) {
          setTemplateId(usageTpl.id);
          setColumnMap({ ...usageTpl.columnMap });
          if (usageTpl.sourceFormat === "invoice") setSourceKind("invoice");
        }
      }
      if (data.duplicateBatchId) {
        setMessage(
          `This file was already imported (batch ${data.duplicateBatchId.slice(0, 8)}…). Rollback to re-import.`
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setColumnMap({ ...tpl.columnMap });
    if (tpl.sourceFormat === "invoice") setSourceKind("invoice");
  };

  const autoMap = () => {
    const next: Record<string, string> = { ...columnMap };
    const lower = Object.fromEntries(headers.map((h) => [h.toLowerCase(), h]));
    const guesses: Record<string, string[]> = {
      timestamp: ["created_at", "start_time", "timestamp", "date", "period_end"],
      provider: ["provider", "vendor", "system"],
      model: ["model", "sku"],
      meter: ["type", "meter", "n_context_tokens_total"],
      quantity: ["tokens", "quantity", "n_context_tokens_total", "seats"],
      cost: ["cost", "cost_usd", "amount"],
      "tags.email": ["email", "user_email", "user"],
      "tags.api_key": ["api_key", "api_key_id", "key_id"],
      "tags.feature": ["feature", "workspace", "project_id"],
      "tags.team": ["team"],
    };
    for (const [target, keys] of Object.entries(guesses)) {
      if (next[target]) continue;
      for (const k of keys) {
        if (lower[k]) {
          next[target] = lower[k];
          break;
        }
      }
    }
    setColumnMap(next);
  };

  const runImport = async () => {
    setBusy(true);
    setMessage(null);
    setErrors([]);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          fileName,
          content,
          sourceKind,
          columnMap,
          mappingTemplateId: templateId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "import failed");
      setMessage(
        `Imported ${data.written} rows · skipped ${data.skipped} · errors ${data.errored}`
      );
      setErrors(data.errors ?? []);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (id: string) => {
    if (!confirm("Rollback this import? Related usage/cost rows will be deleted.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/import/${id}/rollback`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "rollback failed");
      setMessage(`Rolled back · removed ${data.deletedCosts ?? 0} cost rows`);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const requiredOk = useMemo(
    () => Boolean(columnMap.timestamp && columnMap.provider && columnMap.quantity),
    [columnMap]
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Import</h1>
        <p className="muted mt-1">
          Drop a CSV/JSONL usage export or invoice file, map columns, import with
          idempotent dedupe + rollback
        </p>
      </div>

      {message && (
        <div className="panel p-3 text-[12px]" style={{ borderColor: "var(--border-strong)" }}>
          {message}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-medium">1. File</h2>
          <div
            className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 border border-dashed p-4 text-[12px]"
            style={{ borderColor: "var(--border-strong)", color: "var(--muted)" }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void onFile(f);
            }}
            onClick={() => document.getElementById("import-file")?.click()}
          >
            <div>{fileName || "Drop CSV / JSONL here or click to browse"}</div>
            {rowCount > 0 && <div className="mono">{rowCount} rows · preview {preview.length}</div>}
          </div>
          <input
            id="import-file"
            type="file"
            accept=".csv,.jsonl,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <label className="block text-[12px]">
            Source kind
            <select
              className="select mt-1 w-full"
              value={sourceKind}
              onChange={(e) => setSourceKind(e.target.value as typeof sourceKind)}
            >
              <option value="csv">Usage CSV</option>
              <option value="jsonl">Usage JSONL</option>
              <option value="invoice">Invoice / seats</option>
            </select>
          </label>
        </div>

        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-medium">2. Mapping template</h2>
          <select
            className="select w-full"
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
          >
            <option value="">Custom mapping</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.isSystem ? "System · " : ""}
                {t.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={autoMap} disabled={!headers.length}>
            Auto-map from headers
          </button>
        </div>
      </div>

      {headers.length > 0 && (
        <div className="panel space-y-3 p-4">
          <h2 className="text-sm font-medium">3. Column mapper</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {IMPORT_TARGETS.map((t) => (
              <label key={t.key} className="block text-[12px]">
                {t.label}
                {t.required ? " *" : ""}
                <select
                  className="select mt-1 w-full"
                  value={columnMap[t.key] ?? ""}
                  onChange={(e) =>
                    setColumnMap((m) => ({ ...m, [t.key]: e.target.value }))
                  }
                >
                  <option value="">—</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                  <option value="_literal:anthropic">literal: anthropic</option>
                  <option value="_literal:openai">literal: openai</option>
                  <option value="_literal:input_tokens">literal: input_tokens</option>
                  <option value="_literal:seats">literal: seats</option>
                  <option value="_literal:invoice">literal: invoice</option>
                </select>
              </label>
            ))}
          </div>

          <div className="overflow-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  {headers.slice(0, 8).map((h) => (
                    <th key={h} className="p-1 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 8).map((row, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    {headers.slice(0, 8).map((h) => (
                      <td key={h} className="mono p-1">
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="btn"
            disabled={busy || !requiredOk || !content}
            onClick={() => void runImport()}
          >
            {busy ? "Working…" : "Import"}
          </button>
        </div>
      )}

      {errors.length > 0 && (
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">Row errors</h2>
          <ul className="mono space-y-1 text-[11px]">
            {errors.slice(0, 40).map((e, i) => (
              <li key={i}>
                row {e.row}
                {e.field ? ` · ${e.field}` : ""}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">Recent import batches</h2>
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr style={{ color: "var(--muted)" }}>
              <th className="p-1">File</th>
              <th className="p-1">Status</th>
              <th className="p-1">Written</th>
              <th className="p-1">Skipped</th>
              <th className="p-1">Errors</th>
              <th className="p-1" />
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="p-1">{b.fileName}</td>
                <td className="mono p-1">{b.status}</td>
                <td className="mono p-1">{b.rowsWritten}</td>
                <td className="mono p-1">{b.rowsSkipped}</td>
                <td className="mono p-1">{b.rowsErrored}</td>
                <td className="p-1">
                  {b.status === "completed" && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void rollback(b.id)}
                    >
                      Rollback
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td colSpan={6} className="muted p-2">
                  No imports yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RosterImport />
      <OrgStructureImport />
    </div>
  );
}
