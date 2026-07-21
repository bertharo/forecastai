"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileDropZone, type DroppedUpload } from "@/components/FileDropZone";
import { looksLikeTelemetryHeaders } from "@/lib/import/telemetry";
import { normalizeHeaderKey } from "@/lib/import/telemetry";

function looksLikePeopleHeaders(headers: string[]): boolean {
  const lower = new Set(headers.map(normalizeHeaderKey));
  if (looksLikeTelemetryHeaders(headers)) return false;
  const hasWorker =
    lower.has("project_worker") ||
    lower.has("email") ||
    lower.has("work_email") ||
    lower.has("user_email");
  // People file: email/worker plus any non-spend attribute-ish columns
  const hasAttrs =
    [...lower].some(
      (h) =>
        h.startsWith("cost_center") ||
        h === "department" ||
        h === "display_name" ||
        h === "business_unit" ||
        h === "team" ||
        h === "org_unit"
    ) || lower.has("display_name");
  return hasWorker && (hasAttrs || lower.has("display_name") || lower.size >= 2);
}

function guessColumnMap(headers: string[]): Record<string, string> {
  const byLower = Object.fromEntries(
    headers.map((h) => [normalizeHeaderKey(h), h])
  );
  const pick = (...keys: string[]) => {
    for (const k of keys) if (byLower[k]) return byLower[k];
    return undefined;
  };
  const next: Record<string, string> = {};
  const ts = pick("month", "created_at", "start_time", "timestamp", "date", "period_end");
  const provider = pick("ai_tool", "tool", "provider", "vendor", "system");
  const model = pick("model", "sku");
  const quantity = pick("total_tokens", "tokens", "quantity", "seats");
  const cost = pick(
    "total_spend_dollars",
    "total_sepnd_dollars",
    "total_spend",
    "cost",
    "cost_usd",
    "amount",
    "spend"
  );
  const email = pick("email", "user_email", "work_email", "user");
  if (ts) next.timestamp = ts;
  if (provider) next.provider = provider;
  else if (byLower.created_at && byLower.tokens) next.provider = "_literal:anthropic";
  if (model) next.model = model;
  if (quantity) next.quantity = quantity;
  if (cost) next.cost = cost;
  if (email) next["tags.email"] = email;
  const tool = pick("ai_tool", "tool");
  if (tool) next["tags.ai_tool"] = tool;
  if (!next.meter && quantity) next.meter = "_literal:input_tokens";
  return next;
}

async function clearSampleWorkspace(): Promise<void> {
  const res = await fetch("/api/demo/finops-sample", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "clear" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "Could not clear sample");
}

/**
 * Data & sources: click / drag spreadsheet → people or spend import.
 */
export function SourcesSpreadsheetDrop() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [sampleBlocked, setSampleBlocked] = useState(false);
  const [pending, setPending] = useState<DroppedUpload | null>(null);

  async function importUpload(upload: DroppedUpload) {
    const previewRes = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "preview",
        fileName: upload.fileName,
        content: upload.content,
        base64: upload.base64,
        sourceKind: upload.base64 ? "excel" : "csv",
      }),
    });
    const preview = await previewRes.json();
    if (!previewRes.ok) {
      throw new Error(preview.error || "Could not read file");
    }
    const headers: string[] = preview.headers ?? [];

    if (looksLikePeopleHeaders(headers)) {
      const res = await fetch("/api/roster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: upload.content,
          base64: upload.base64,
          fileName: upload.fileName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.message || data.error || "People import failed") as Error & {
          code?: string;
        };
        err.code = data.error;
        throw err;
      }
      setMsg(`Added ${data.upserted} people from ${upload.fileName}`);
      router.refresh();
      return;
    }

    const columnMap = guessColumnMap(headers);
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "import",
        fileName: upload.fileName,
        content: upload.content,
        base64: upload.base64,
        sourceKind: upload.base64 ? "excel" : "csv",
        columnMap,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || data.error || "Spend import failed") as Error & {
        code?: string;
      };
      err.code = data.error;
      throw err;
    }
    setMsg(
      `Imported ${data.written ?? 0} spend rows from ${upload.fileName}` +
        (data.errored ? ` · ${data.errored} problems` : "")
    );
    router.refresh();
  }

  async function onFile(upload: DroppedUpload) {
    setBusy(true);
    setMsg(null);
    setErr(false);
    setSampleBlocked(false);
    setPending(upload);
    try {
      await importUpload(upload);
      setPending(null);
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      const message = e instanceof Error ? e.message : String(e);
      setErr(true);
      if (code === "sample_active" || /sample data is active/i.test(message)) {
        setSampleBlocked(true);
        setMsg(
          "Sample data is active in this workspace. Clear it to upload your real spreadsheet (this removes the sample pack)."
        );
      } else {
        setMsg(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function clearSampleAndRetry() {
    if (!pending) return;
    setBusy(true);
    setMsg(null);
    setErr(false);
    try {
      await clearSampleWorkspace();
      setSampleBlocked(false);
      await importUpload(pending);
      setPending(null);
      router.refresh();
    } catch (e) {
      setErr(true);
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="soft-card space-y-3">
      <div>
        <div className="text-[15px] font-semibold">Upload a spreadsheet</div>
        <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
          Drop people (email + attributes) or spend (email × month ×
          tool). CSV or Excel — first sheet only.
        </p>
      </div>
      <FileDropZone
        disabled={busy}
        label={busy ? "Uploading…" : "Drop a CSV or Excel file here, or click to browse"}
        hint="We’ll detect people vs spend from the headers."
        onFile={onFile}
      />
      {msg && (
        <div className="space-y-2">
          <p
            className="text-[13px]"
            style={{ color: err ? "var(--danger)" : "var(--muted)" }}
          >
            {msg}
          </p>
          {sampleBlocked && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn"
                disabled={busy || !pending}
                onClick={() => void clearSampleAndRetry()}
              >
                {busy ? "Clearing…" : "Clear sample & upload"}
              </button>
              <Link href="/settings" className="text-[12px] underline" style={{ color: "var(--muted)" }}>
                Or manage sample in Settings
              </Link>
            </div>
          )}
        </div>
      )}
      <p className="text-[12px]" style={{ color: "var(--muted)" }}>
        Need column mapping?{" "}
        <Link href="/import" className="underline">
          Open Import
        </Link>
      </p>
    </div>
  );
}
