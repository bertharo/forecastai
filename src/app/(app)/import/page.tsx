"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IMPORT_TARGETS } from "@/lib/import/parse";
import { OrgStructureImport } from "@/components/OrgStructureImport";
import { RosterImport } from "@/components/RosterImport";
import { isExcelFileName, readUploadPayload } from "@/lib/import/uploadClient";

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
  errorReport?: { row: number; field?: string; message: string }[] | null;
};

function pickUsageTemplate(
  templates: Template[],
  headers: string[]
): Template | undefined {
  const lower = new Set(headers.map((h) => h.toLowerCase().replace(/[\s\-]+/g, "_")));
  const usable = templates.filter(
    (t) => t.sourceFormat !== "org_structure" && t.sourceFormat !== "dx_ai_metrics"
  );
  if (!usable.length) return undefined;

  // Monthly AI telemetry: email + month + ai_tool + spend/tokens
  if (
    (lower.has("email") || lower.has("user_email")) &&
    lower.has("month") &&
    (lower.has("ai_tool") || lower.has("tool")) &&
    (lower.has("total_spend_dollars") ||
      lower.has("total_sepnd_dollars") ||
      lower.has("total_tokens") ||
      lower.has("total_spend"))
  ) {
    return (
      usable.find((t) => t.sourceFormat === "telemetry_monthly") ??
      usable.find((t) => /telemetry/i.test(t.name))
    );
  }

  // Anthropic console: created_at + model + tokens
  if (lower.has("created_at") && lower.has("model") && lower.has("tokens")) {
    return (
      usable.find((t) => /anthropic/i.test(t.name)) ??
      usable.find((t) => t.columnMap.timestamp === "created_at")
    );
  }
  // OpenAI-style
  if (lower.has("start_time") || lower.has("n_context_tokens_total")) {
    return usable.find((t) => /openai/i.test(t.name));
  }
  // Seat / invoice
  if (lower.has("seats") || (lower.has("vendor") && lower.has("amount"))) {
    return (
      usable.find((t) => /cursor|seat/i.test(t.name)) ??
      usable.find((t) => t.sourceFormat === "invoice")
    );
  }
  return usable.find((t) => t.sourceFormat === "usage_export") ?? usable[0];
}

function summarizeErrors(
  errors: { row: number; field?: string; message: string }[] | null | undefined
): string | null {
  if (!errors?.length) return null;
  const counts = new Map<string, number>();
  for (const e of errors) {
    const key = e.message;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const extra = counts.size > 1 ? ` (+${counts.size - 1} other issue types)` : "";
  return `${top[1]}× ${top[0]}${extra}`;
}

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
  const [base64, setBase64] = useState<string | undefined>(undefined);
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
    const payload = await readUploadPayload(file);
    setFileName(payload.fileName);
    setContent(payload.content ?? "");
    setBase64(payload.base64);
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
          fileName: payload.fileName,
          content: payload.content,
          base64: payload.base64,
          sourceKind: isExcelFileName(payload.fileName) ? "excel" : kind,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read file");
      const hdrs: string[] = data.headers ?? [];
      setHeaders(hdrs);
      setPreview(data.preview ?? []);
      setRowCount(data.rowCount ?? 0);
      const norm = (h: string) => h.toLowerCase().replace(/[\s\-]+/g, "_");
      const lower = new Set(hdrs.map(norm));
      const byLower = Object.fromEntries(hdrs.map((h) => [norm(h), h]));
      const looksDx =
        lower.has("tool") && (lower.has("spend") || lower.has("cost")) && lower.has("day");
      const looksOrg =
        lower.has("node_name") &&
        (lower.has("parent_name") || lower.has("dimension_type"));
      const looksTelemetry =
        (lower.has("email") || lower.has("user_email")) &&
        lower.has("month") &&
        (lower.has("ai_tool") || lower.has("tool")) &&
        (lower.has("total_spend_dollars") ||
          lower.has("total_sepnd_dollars") ||
          lower.has("total_tokens") ||
          lower.has("total_spend"));
      const looksUsage =
        looksTelemetry ||
        ((lower.has("cost") ||
          lower.has("cost_usd") ||
          lower.has("amount") ||
          lower.has("total_spend_dollars")) &&
          (lower.has("model") ||
            lower.has("tokens") ||
            lower.has("total_tokens") ||
            lower.has("created_at") ||
            lower.has("month") ||
            lower.has("seats")));
      const looksSeats = lower.has("seats") || lower.has("vendor");

      if (looksDx) {
        setMessage(
          "This looks like a coding-tools export — upload it under Data & sources → coding tools, not here."
        );
      } else if (looksOrg) {
        setMessage("This looks like an org chart — switch to the Teams tab.");
        setTab("teams");
      } else if (!looksOrg && (looksUsage || looksSeats) && templates.length) {
        const usageTpl = pickUsageTemplate(templates, hdrs);
        const next: Record<string, string> = { ...(usageTpl?.columnMap ?? {}) };

        // Header-based guesses fill gaps (and fix wrong template columns)
        const guesses: Record<string, string[]> = {
          timestamp: [
            "month",
            "created_at",
            "start_time",
            "timestamp",
            "date",
            "period_end",
            "usage_month",
          ],
          provider: ["ai_tool", "tool", "provider", "vendor", "system", "product"],
          model: ["model", "sku"],
          meter: ["type", "meter", "n_context_tokens_total"],
          quantity: [
            "total_tokens",
            "tokens",
            "quantity",
            "n_context_tokens_total",
            "seats",
          ],
          cost: [
            "total_spend_dollars",
            "total_sepnd_dollars",
            "total_spend",
            "spend_dollars",
            "cost",
            "cost_usd",
            "amount",
            "spend",
          ],
          "tags.email": ["email", "user_email", "user", "work_email"],
          "tags.ai_tool": ["ai_tool", "tool", "product"],
          "tags.api_key": ["api_key", "api_key_id", "key_id"],
          "tags.seat_status": ["seat_status"],
        };
        for (const [target, keys] of Object.entries(guesses)) {
          // Keep template literals (e.g. meter=_literal:input_tokens) unless a real column matches
          if (next[target]?.startsWith("_literal:")) {
            const hasReal = keys.some((k) => byLower[k]);
            if (!hasReal) continue;
          }
          for (const k of keys) {
            if (byLower[k]) {
              next[target] = byLower[k];
              break;
            }
          }
        }
        // Anthropic / OpenAI exports rarely include a vendor column
        if (!next.provider || (next.provider && !next.provider.startsWith("_literal:") && !byLower[norm(next.provider)])) {
          if (looksTelemetry && byLower.ai_tool) {
            next.provider = byLower.ai_tool;
          } else if (lower.has("created_at") && lower.has("tokens")) {
            next.provider = "_literal:anthropic";
          } else if (lower.has("n_context_tokens_total") || lower.has("start_time")) {
            next.provider = "_literal:openai";
          } else if (looksSeats && !byLower.vendor) {
            next.provider = "_literal:cursor";
          }
        }
        // Drop mapped sources that aren't in this file (except literals)
        for (const [target, source] of Object.entries(next)) {
          if (!source || source.startsWith("_literal:")) continue;
          if (!byLower[norm(source)] && !hdrs.includes(source)) {
            delete next[target];
          }
        }
        // Re-apply guesses for anything we deleted
        for (const [target, keys] of Object.entries(guesses)) {
          if (next[target]) continue;
          for (const k of keys) {
            if (byLower[k]) {
              next[target] = byLower[k];
              break;
            }
          }
        }
        if (!next.provider) {
          if (looksTelemetry && byLower.ai_tool) {
            next.provider = byLower.ai_tool;
          } else if (lower.has("created_at") && lower.has("tokens")) {
            next.provider = "_literal:anthropic";
          }
        }

        if (usageTpl) {
          setTemplateId(usageTpl.id);
          if (usageTpl.sourceFormat === "invoice" || looksSeats) {
            setSourceKind("invoice");
          }
        }
        setColumnMap(next);
        setMessage(
          usageTpl
            ? `Matched “${usageTpl.name}” — check the column mapping, then upload.`
            : "Guessed columns from your headers — check the mapping, then upload."
        );
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
    const lower = Object.fromEntries(
      headers.map((h) => [h.toLowerCase().replace(/[\s\-]+/g, "_"), h])
    );
    const guesses: Record<string, string[]> = {
      timestamp: [
        "month",
        "created_at",
        "start_time",
        "timestamp",
        "date",
        "period_end",
        "usage_month",
      ],
      provider: ["ai_tool", "tool", "provider", "vendor", "system", "product"],
      model: ["model", "sku"],
      meter: ["type", "meter", "n_context_tokens_total"],
      quantity: [
        "total_tokens",
        "tokens",
        "quantity",
        "n_context_tokens_total",
        "seats",
      ],
      cost: [
        "total_spend_dollars",
        "total_sepnd_dollars",
        "total_spend",
        "spend_dollars",
        "cost",
        "cost_usd",
        "amount",
        "spend",
      ],
      "tags.email": ["email", "user_email", "user", "work_email"],
      "tags.ai_tool": ["ai_tool", "tool", "product"],
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

  const waitForBatch = async (name: string, startedAt: number) => {
    // Browser / proxy may drop the POST while the server keeps writing — poll Past uploads.
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch("/api/import");
      const data = await res.json();
      const list = (data.batches ?? []) as Batch[];
      setBatches(list);
      setTemplates(data.templates ?? []);
      const match = list.find(
        (b) =>
          b.fileName === name &&
          new Date(b.createdAt).getTime() >= startedAt - 5000 &&
          (b.status === "completed" || b.status === "failed")
      );
      if (match) return match;
      if (i % 5 === 4) {
        setMessage(
          `Still uploading ${name}… large files can take a few minutes. Don’t close this tab.`
        );
      }
    }
    return null;
  };

  const runImport = async () => {
    setBusy(true);
    setMessage(
      rowCount > 5000
        ? `Uploading ${rowCount.toLocaleString()} rows — this can take a few minutes…`
        : "Uploading…"
    );
    setErrors([]);
    const startedAt = Date.now();
    try {
      const post = fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "import",
          fileName,
          content: content || undefined,
          base64,
          sourceKind: isExcelFileName(fileName) ? "excel" : sourceKind,
          columnMap,
          mappingTemplateId: templateId || null,
        }),
      });

      // Race: prefer POST body; if the connection dies, fall back to polling
      const raced = await Promise.race([
        post.then(async (res) => {
          const data = await res.json().catch(() => ({}));
          return { kind: "post" as const, res, data };
        }),
        waitForBatch(fileName, startedAt).then((batch) => ({
          kind: "poll" as const,
          batch,
        })),
      ]);

      if (raced.kind === "post") {
        if (
          !raced.res.ok &&
          raced.data?.error !== "duplicate_file"
        ) {
          // POST may 504 while work finished — check batches
          const batch = await waitForBatch(fileName, startedAt);
          if (batch?.status === "completed") {
            setMessage(
              `Done — ${batch.rowsWritten} rows added` +
                (batch.rowsSkipped ? ` · ${batch.rowsSkipped} already had` : "")
            );
            await refresh();
            setTab("history");
            return;
          }
          throw new Error(
            raced.data.message || raced.data.error || "Upload failed"
          );
        }
        if (raced.data?.error === "duplicate_file") {
          setMessage(
            "This file is already uploaded. See Past uploads (you can Undo and retry)."
          );
          await refresh();
          setTab("history");
          return;
        }
        setMessage(
          `Done — ${raced.data.written} rows added` +
            (raced.data.skipped ? ` · ${raced.data.skipped} already had` : "") +
            (raced.data.errored ? ` · ${raced.data.errored} had problems` : "")
        );
        setErrors(raced.data.errors ?? []);
        await refresh();
        setTab("history");
        return;
      }

      if (raced.batch?.status === "completed") {
        setMessage(
          `Done — ${raced.batch.rowsWritten} rows added` +
            (raced.batch.rowsSkipped
              ? ` · ${raced.batch.rowsSkipped} already had`
              : "")
        );
        await refresh();
        setTab("history");
        return;
      }
      if (raced.batch?.status === "failed") {
        setMessage(
          `Upload failed — ${summarizeErrors(raced.batch.errorReport) ?? "see Past uploads"}`
        );
        await refresh();
        setTab("history");
        return;
      }
      setMessage(
        "Upload is still running in the background. Refresh Past uploads in a minute."
      );
      await refresh();
      setTab("history");
    } catch (e) {
      // Last chance: server may have finished after a network error
      const batch = await waitForBatch(fileName, startedAt).catch(() => null);
      if (batch?.status === "completed") {
        setMessage(`Done — ${batch.rowsWritten} rows added`);
        await refresh();
        setTab("history");
      } else {
        setMessage(e instanceof Error ? e.message : String(e));
      }
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

  const visibleBatches = (() => {
    // Prefer newest success for a filename; keep older failures collapsed under it
    const byName = new Map<string, Batch[]>();
    for (const b of batches) {
      const list = byName.get(b.fileName) ?? [];
      list.push(b);
      byName.set(b.fileName, list);
    }
    const out: Batch[] = [];
    for (const list of byName.values()) {
      list.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const best =
        list.find((b) => b.status === "completed") ??
        list.find((b) => b.status === "importing") ??
        list[0];
      if (best) out.push(best);
    }
    out.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return out;
  })();

  return (
    <div className="space-y-5">
      <p className="text-[14px]" style={{ color: "var(--muted)" }}>
        Upload a people list, then a bill or usage file. Prefer a live sync?{" "}
        <Link href="/connectors" className="underline">
          Connect Anthropic / Cursor →
        </Link>
      </p>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="pill-tab"
            data-active={tab === t.id}
            onClick={() => {
              setTab(t.id);
              if (t.id === "history") void refresh();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message && (
        <div className="panel p-3 text-[13px]">
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
            Undo a bad upload anytime. Failed rows show a short reason below.
          </p>
          <div className="mt-4 space-y-3">
            {visibleBatches.map((b) => {
              const why = summarizeErrors(b.errorReport);
              return (
                <div
                  key={b.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-t pt-3 first:border-0 first:pt-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold">{b.fileName}</div>
                    <div className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
                      {b.status === "failed" ? (
                        <span style={{ color: "var(--danger)" }}>Failed</span>
                      ) : b.status === "importing" ? (
                        <span style={{ color: "var(--warning)" }}>Still uploading…</span>
                      ) : (
                        <span style={{ color: "var(--success)" }}>Uploaded</span>
                      )}
                      {" · "}
                      {b.rowsWritten.toLocaleString()} added ·{" "}
                      {b.rowsSkipped.toLocaleString()} already had ·{" "}
                      {b.rowsErrored.toLocaleString()} problems
                    </div>
                    {b.status === "completed" && (
                      <p className="mt-1 text-[13px]" style={{ color: "var(--success)" }}>
                        Spend rows are in — check Home for vendor / department totals.
                      </p>
                    )}
                    {why && b.status === "failed" && (
                      <p className="mt-1 text-[13px]" style={{ color: "var(--danger)" }}>
                        Why: {why}
                      </p>
                    )}
                    {b.status === "failed" && (
                      <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
                        Fix: Bills & usage → drop the file again → Upload spend.
                      </p>
                    )}
                  </div>
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
                </div>
              );
            })}
            {visibleBatches.length === 0 && (
              <p className="text-[13px]" style={{ color: "var(--muted)" }}>
                No uploads yet.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === "bills" && (
        <div className="space-y-3">
          <div className="soft-card space-y-3">
            <div>
              <h2 className="text-[15px] font-semibold">Bills & usage</h2>
              <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
                Preferred telemetry columns:{" "}
                <span className="mono text-[12px]" style={{ color: "var(--fg)" }}>
                  email, month, ai_tool, model, total_tokens, total_spend_dollars
                </span>
                . Also accepts Anthropic / OpenAI exports and seat invoices (CSV or Excel).
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
                {fileName || "Drop a CSV or Excel file here, or click to browse"}
              </div>
              {rowCount > 0 && (
                <div>
                  {rowCount.toLocaleString()} rows · showing first {preview.length}
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2 text-[12px]">
                <a
                  className="underline"
                  href="/fixtures/telemetry-spend.csv"
                  onClick={(e) => e.stopPropagation()}
                >
                  Example telemetry file
                </a>
                <span>·</span>
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
              accept=".csv,.jsonl,.txt,.xlsx,.xls,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
