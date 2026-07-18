"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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

type Tab = "people" | "bills" | "teams" | "history";

const FRIENDLY_TARGET: Record<string, string> = {
  timestamp: "When",
  provider: "Vendor",
  model: "Model",
  meter: "What was used",
  quantity: "How much",
  cost: "Cost ($)",
  "tags.email": "Person email",
  "tags.api_key": "API key",
  "tags.feature": "Feature / project",
  "tags.team": "Team tag",
  "tags.environment": "Environment",
  "tags.seat_status": "Seat status",
};

export default function ImportPage() {
  const [tab, setTab] = useState<Tab>("bills");
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
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      if (!res.ok) throw new Error(data.error || "Could not read file");
      const hdrs: string[] = data.headers ?? [];
      setHeaders(hdrs);
      setPreview(data.preview ?? []);
      setRowCount(data.rowCount ?? 0);
      const lower = new Set(hdrs.map((h) => h.toLowerCase()));
      const looksDx =
        lower.has("tool") && (lower.has("spend") || lower.has("cost")) && lower.has("day");
      const looksOrg =
        lower.has("node_name") &&
        (lower.has("parent_name") || lower.has("dimension_type"));
      const looksUsage =
        (lower.has("cost") || lower.has("cost_usd") || lower.has("amount")) &&
        (lower.has("model") || lower.has("tokens") || lower.has("created_at") || lower.has("seats"));
      const looksSeats = lower.has("seats") || lower.has("vendor");

      if (looksDx) {
        setMessage(
          "This looks like a coding-tools export — upload it under Data & sources → coding tools, not here."
        );
      } else if (looksOrg) {
        setMessage("This looks like an org chart — switch to the Teams tab.");
        setTab("teams");
      } else if (!looksOrg && (looksUsage || looksSeats) && templates.length) {
        const usageTpl =
          templates.find(
            (t) =>
              t.sourceFormat !== "org_structure" && t.sourceFormat !== "dx_ai_metrics"
          ) ?? templates.find((t) => t.sourceFormat !== "org_structure");
        if (usageTpl) {
          setTemplateId(usageTpl.id);
          setColumnMap({ ...usageTpl.columnMap });
          if (usageTpl.sourceFormat === "invoice" || looksSeats) setSourceKind("invoice");
        }
        // Also run auto-map for email etc.
        const next: Record<string, string> = { ...(usageTpl?.columnMap ?? {}) };
        const byLower = Object.fromEntries(hdrs.map((h) => [h.toLowerCase(), h]));
        const guesses: Record<string, string[]> = {
          timestamp: ["created_at", "start_time", "timestamp", "date", "period_end"],
          provider: ["provider", "vendor", "system"],
          model: ["model", "sku"],
          meter: ["type", "meter", "n_context_tokens_total"],
          quantity: ["tokens", "quantity", "n_context_tokens_total", "seats"],
          cost: ["cost", "cost_usd", "amount"],
          "tags.email": ["email", "user_email", "user"],
          "tags.api_key": ["api_key", "api_key_id", "key_id"],
        };
        for (const [target, keys] of Object.entries(guesses)) {
          if (next[target]) continue;
          for (const k of keys) {
            if (byLower[k]) {
              next[target] = byLower[k];
              break;
            }
          }
        }
        setColumnMap(next);
      }
      if (data.duplicateBatchId) {
        setMessage(
          "You’ve already uploaded this file. Undo it under Past uploads if you want to try again."
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
      "tags.seat_status": ["seat_status"],
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
      if (!res.ok) throw new Error(data.message || data.error || "Upload failed");
      setMessage(
        `Done — ${data.written} rows added` +
          (data.skipped ? ` · ${data.skipped} already had` : "") +
          (data.errored ? ` · ${data.errored} had problems` : "")
      );
      setErrors(data.errors ?? []);
      await refresh();
      setTab("history");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (id: string) => {
    if (!confirm("Undo this upload? Those spend rows will be removed.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/import/${id}/rollback`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not undo");
      setMessage(`Undone — removed ${data.deletedCosts ?? 0} spend rows`);
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

  const tabs: { id: Tab; label: string }[] = [
    { id: "people", label: "People" },
    { id: "bills", label: "Bills & usage" },
    { id: "teams", label: "Teams" },
    { id: "history", label: "Past uploads" },
  ];

  return (
    <div className="space-y-5">
      <div className="soft-card" style={{ background: "var(--card-mint)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          Upload
        </div>
        <p className="mt-2 max-w-2xl text-[18px] font-semibold leading-snug">
          Add a people list, then a bill or usage file. That’s enough for department spend —
          no live connector required.
        </p>
        <p className="mt-2 text-[13px]" style={{ color: "#3a4050" }}>
          Prefer a live sync?{" "}
          <Link href="/connectors" className="underline">
            Connect Anthropic / Cursor →
          </Link>
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="pill-tab"
            data-active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="soft-card text-[13px]" style={{ background: "var(--card-blue)" }}>
          {message}
        </div>
      )}

      {tab === "people" && (
        <div className="soft-card">
          <RosterImport />
        </div>
      )}

      {tab === "teams" && (
        <div className="soft-card space-y-3">
          <div>
            <h2 className="text-[15px] font-semibold">Teams</h2>
            <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
              Optional — paste your org chart if you want BU → department → team slices.
            </p>
          </div>
          <OrgStructureImport bare />
        </div>
      )}

      {tab === "history" && (
        <div className="soft-card">
          <h2 className="text-[15px] font-semibold">Past uploads</h2>
          <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
            Undo a bad upload anytime.
          </p>
          <table className="mt-4 w-full text-left text-[13px]">
            <thead>
              <tr style={{ color: "var(--muted)" }}>
                <th className="pb-2 pr-2">File</th>
                <th className="pb-2 pr-2">Status</th>
                <th className="pb-2 pr-2">Added</th>
                <th className="pb-2 pr-2">Already had</th>
                <th className="pb-2 pr-2">Problems</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-2 pr-2">{b.fileName}</td>
                  <td className="py-2 pr-2">{b.status}</td>
                  <td className="py-2 pr-2">{b.rowsWritten}</td>
                  <td className="py-2 pr-2">{b.rowsSkipped}</td>
                  <td className="py-2 pr-2">{b.rowsErrored}</td>
                  <td className="py-2">
                    {b.status === "completed" && (
                      <button
                        type="button"
                        className="btn btn-ghost text-[12px]"
                        disabled={busy}
                        onClick={() => void rollback(b.id)}
                      >
                        Undo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4" style={{ color: "var(--muted)" }}>
                    No uploads yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "bills" && (
        <div className="space-y-3">
          <div className="soft-card space-y-3">
            <div>
              <h2 className="text-[15px] font-semibold">Bills & usage</h2>
              <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
                Drop an Anthropic / OpenAI export or a seat invoice. We’ll guess the columns;
                fix anything that looks wrong before uploading.
              </p>
            </div>

            <div
              className="flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-[13px]"
              style={{ borderColor: "var(--border-strong)", color: "var(--muted)" }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) void onFile(f);
              }}
              onClick={() => document.getElementById("import-file")?.click()}
            >
              <div className="text-[15px] font-medium" style={{ color: "var(--fg)" }}>
                {fileName || "Drop a CSV here, or click to browse"}
              </div>
              {rowCount > 0 && (
                <div>
                  {rowCount.toLocaleString()} rows · showing first {preview.length}
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2 text-[12px]">
                <a
                  className="underline"
                  href="/fixtures/vendor-anthropic-usage.csv"
                  onClick={(e) => e.stopPropagation()}
                >
                  Example usage file
                </a>
                <span>·</span>
                <a
                  className="underline"
                  href="/fixtures/vendor-cursor-seats.csv"
                  onClick={(e) => e.stopPropagation()}
                >
                  Example seats file
                </a>
              </div>
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

            <label className="block text-[12px]" style={{ color: "var(--muted)" }}>
              What kind of file?
              <select
                className="select mt-1 w-full max-w-xs"
                value={sourceKind}
                onChange={(e) => setSourceKind(e.target.value as typeof sourceKind)}
              >
                <option value="csv">Usage export (tokens / API)</option>
                <option value="invoice">Invoice / seats</option>
                <option value="jsonl">JSONL export</option>
              </select>
            </label>
          </div>

          {headers.length > 0 && (
            <div className="soft-card space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[15px] font-semibold">Match your columns</div>
                  <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
                    Required: when, vendor, and how much. Email helps department rollups.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="select text-[13px]"
                    value={templateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                  >
                    <option value="">Guess for me</option>
                    {templates
                      .filter(
                        (t) =>
                          t.sourceFormat !== "org_structure" &&
                          t.sourceFormat !== "dx_ai_metrics"
                      )
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost text-[13px]"
                    onClick={autoMap}
                  >
                    Re-guess
                  </button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {IMPORT_TARGETS.filter(
                  (t) =>
                    t.required ||
                    t.key === "cost" ||
                    t.key === "model" ||
                    t.key === "tags.email" ||
                    t.key === "tags.api_key" ||
                    showAdvanced
                ).map((t) => (
                  <label key={t.key} className="block text-[12px]">
                    {FRIENDLY_TARGET[t.key] ?? t.label}
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
                      <option value="_literal:anthropic">Always: anthropic</option>
                      <option value="_literal:openai">Always: openai</option>
                      <option value="_literal:cursor">Always: cursor</option>
                      <option value="_literal:seats">Always: seats</option>
                    </select>
                  </label>
                ))}
              </div>

              <button
                type="button"
                className="text-[12px] underline"
                style={{ color: "var(--muted)" }}
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? "Hide extra fields" : "Show more fields"}
              </button>

              <div className="overflow-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr style={{ color: "var(--muted)", background: "var(--panel-soft)" }}>
                      {headers.slice(0, 6).map((h) => (
                        <th key={h} className="p-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 5).map((row, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                        {headers.slice(0, 6).map((h) => (
                          <td key={h} className="mono p-2">
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
                {busy ? "Uploading…" : "Upload spend"}
              </button>
              {!requiredOk && (
                <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                  Fill When, Vendor, and How much to continue.
                </p>
              )}
            </div>
          )}

          {errors.length > 0 && (
            <div className="soft-card">
              <h2 className="text-[13px] font-semibold">Rows with problems</h2>
              <ul className="mt-2 space-y-1 text-[12px] mono">
                {errors.slice(0, 40).map((e, i) => (
                  <li key={i}>
                    row {e.row}
                    {e.field ? ` · ${e.field}` : ""}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
