"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileDropZone, type DroppedUpload } from "@/components/FileDropZone";
import { looksLikeTelemetryHeaders } from "@/lib/import/telemetry";
import { normalizeHeaderKey } from "@/lib/import/telemetry";
import {
  parseCsv,
  computeContentHash,
  chunkRowsByBytes,
  rowsToCsv,
  safeJsonResponse,
  type RawRow,
} from "@/lib/import/uploadClient";

const CHUNK_RETRY_LIMIT = 2;

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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  /**
   * CSV spend files never send the whole file in one request — the file is
   * parsed locally and pushed as small byte-capped chunks, mirroring
   * src/app/(app)/import/page.tsx's runChunkedImport. A single whole-file
   * POST (the old approach) reliably 413s on real-world spend exports once
   * they cross Vercel's platform request-size limit.
   */
  async function importSpendChunked(
    upload: DroppedUpload,
    headers: string[],
    rows: RawRow[]
  ) {
    const contentHash = await computeContentHash(headers, rows);
    const dupRes = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "checkDuplicate", contentHash }),
    });
    const dupData = await safeJsonResponse(dupRes);
    if (dupData.duplicateBatchId) {
      throw new Error(
        "This file was already uploaded. Undo it under Import → Past uploads if you want to try again."
      );
    }

    const columnMap = guessColumnMap(headers);
    const startRes = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "startBatch",
        fileName: upload.fileName,
        contentHash,
        rowCount: rows.length,
        sourceKind: "csv",
      }),
    });
    const startData = await safeJsonResponse(startRes);
    if (!startRes.ok) {
      const e = new Error(
        (startData.message as string) || (startData.error as string) || "Upload failed to start"
      ) as Error & { code?: string };
      e.code = startData.error as string | undefined;
      throw e;
    }
    const batchId = startData.batchId as string;

    const chunks = chunkRowsByBytes(headers, rows);
    let written = 0;
    let errored = 0;
    let rowsDone = 0;
    setProgress({ done: 0, total: rows.length });

    try {
      for (const chunk of chunks) {
        const chunkContent = rowsToCsv(headers, chunk);
        let chunkResult: Record<string, unknown> | null = null;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt <= CHUNK_RETRY_LIMIT && !chunkResult; attempt++) {
          try {
            const res = await fetch("/api/import", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "importChunk",
                batchId,
                content: chunkContent,
                columnMap,
                sourceKind: "csv",
              }),
            });
            const data = await safeJsonResponse(res);
            if (!res.ok) throw new Error((data.error as string) || "Chunk upload failed");
            chunkResult = data;
          } catch (e) {
            lastErr = e;
          }
        }
        if (!chunkResult) {
          throw lastErr instanceof Error ? lastErr : new Error("Chunk upload failed after retries");
        }
        written += Number(chunkResult.written ?? 0);
        errored += Number(chunkResult.errored ?? 0);
        rowsDone += chunk.length;
        setProgress({ done: rowsDone, total: rows.length });
      }
    } catch (e) {
      await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "finishBatch", batchId }),
      }).catch(() => {});
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      setProgress(null);
    }

    const finishRes = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "finishBatch", batchId }),
    });
    const finishData = await safeJsonResponse(finishRes);
    setMsg(
      `Imported ${finishData.written ?? written} spend rows from ${upload.fileName}` +
        (Number(finishData.errored ?? errored) ? ` · ${finishData.errored ?? errored} problems` : "")
    );
    router.refresh();
  }

  async function importUpload(upload: DroppedUpload) {
    if (upload.base64) {
      // Excel: single-file path (chunking needs a browser xlsx parser —
      // out of scope; see src/app/(app)/import/page.tsx for the rationale).
      const previewRes = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          fileName: upload.fileName,
          base64: upload.base64,
          sourceKind: "excel",
        }),
      });
      const preview = await safeJsonResponse(previewRes);
      if (!previewRes.ok) {
        throw new Error((preview.error as string) || "Could not read file");
      }
      const headers: string[] = (preview.headers as string[]) ?? [];

      if (looksLikePeopleHeaders(headers)) {
        const res = await fetch("/api/roster", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ base64: upload.base64, fileName: upload.fileName }),
        });
        const data = await safeJsonResponse(res);
        if (!res.ok) {
          const err = new Error(
            (data.message as string) || (data.error as string) || "People import failed"
          ) as Error & { code?: string };
          err.code = data.error as string | undefined;
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
          base64: upload.base64,
          sourceKind: "excel",
          columnMap,
        }),
      });
      const data = await safeJsonResponse(res);
      if (!res.ok) {
        const err = new Error(
          (data.message as string) || (data.error as string) || "Spend import failed"
        ) as Error & { code?: string };
        err.code = data.error as string | undefined;
        throw err;
      }
      setMsg(
        `Imported ${data.written ?? 0} spend rows from ${upload.fileName}` +
          (data.errored ? ` · ${data.errored} problems` : "")
      );
      router.refresh();
      return;
    }

    // CSV: parse locally so headers/people-vs-spend detection never sends
    // the whole file in a request.
    const { headers, rows } = parseCsv(upload.content ?? "");

    if (looksLikePeopleHeaders(headers)) {
      const res = await fetch("/api/roster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: upload.content, fileName: upload.fileName }),
      });
      const data = await safeJsonResponse(res);
      if (!res.ok) {
        const err = new Error(
          (data.message as string) || (data.error as string) || "People import failed"
        ) as Error & { code?: string };
        err.code = data.error as string | undefined;
        throw err;
      }
      setMsg(`Added ${data.upserted} people from ${upload.fileName}`);
      router.refresh();
      return;
    }

    await importSpendChunked(upload, headers, rows);
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
        <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
          Re-uploading a period you&apos;ve already loaded adds to it rather than
          replacing it — if you&apos;re correcting data, undo the old batch first
          under Import → Past uploads.
        </p>
      </div>
      <FileDropZone
        disabled={busy}
        label={
          progress
            ? `Uploading… ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} rows`
            : busy
              ? "Uploading…"
              : "Drop a CSV or Excel file here, or click to browse"
        }
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
