"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone } from "@/components/FileDropZone";
import { safeJsonResponse } from "@/lib/import/uploadClient";

export function RosterImport() {
  const router = useRouter();
  const [payload, setPayload] = useState<{
    fileName: string;
    content?: string;
    base64?: string;
  } | null>(null);
  const [previewText, setPreviewText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);

  async function importRoster() {
    if (!payload) return;
    setBusy(true);
    setMsg(null);
    setErrors([]);
    try {
      const res = await fetch("/api/roster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          csv: payload.content,
          content: payload.content,
          base64: payload.base64,
          fileName: payload.fileName,
        }),
      });
      const data = await safeJsonResponse(res);
      if (!res.ok) throw new Error((data.message as string) || (data.error as string) || "Import failed");

      const errList = (data.errors ?? []) as { row: number; message: string }[];
      setErrors(errList);

      const upserted = Number(data.upserted ?? 0);
      if (upserted > 0) {
        setMsg(
          `Added ${upserted} people` +
            (data.skipped ? ` · skipped ${data.skipped}` : "")
        );
        setPayload(null);
        setPreviewText("");
        router.refresh();
      } else {
        setMsg(
          errList[0]?.message ||
            "Upload failed — no people were added. Check the columns and try again."
        );
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="roster" className="space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold">People</h2>
        <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
          Upload people as CSV or Excel. We join spend on <strong>Email</strong>. Every
          other column is stored as an attribute you can enable as an org dimension on
          Sources.
        </p>
      </div>
      <FileDropZone
        disabled={busy}
        className="min-h-[100px]"
        label={
          payload?.fileName
            ? `Ready: ${payload.fileName}`
            : "Drop a CSV or Excel file here, or click to browse"
        }
        onFile={async (u) => {
          setMsg(null);
          setErrors([]);
          setPayload({
            fileName: u.fileName,
            content: u.content,
            base64: u.base64,
          });
          if (u.content) {
            setPreviewText(u.content);
          } else {
            setPreviewText(
              `(Excel file “${u.fileName}” — ${Math.round((u.file.size / 1024) * 10) / 10} KB)\nColumns will be read from the first sheet on upload.`
            );
          }
        }}
      />
      <div className="flex flex-wrap gap-2">
        <a
          className="btn btn-ghost text-[13px]"
          href="/fixtures/people-cost-center-chain.csv"
        >
          Download example
        </a>
        <a className="btn btn-ghost text-[13px]" href="/fixtures/hris-roster.csv">
          Simple roster example
        </a>
        <a
          className="btn btn-ghost text-[13px]"
          href="/fixtures/people-cost-center-chain.xlsx"
        >
          Excel example
        </a>
      </div>
      <details className="text-[12px]" style={{ color: "var(--muted)" }}>
        <summary className="cursor-pointer">What columns do I need?</summary>
        <p className="mt-2">
          Required: <strong>Email</strong> (or <strong>Project Worker</strong> if it contains
          the email). Optional: display name plus any attribute columns (org unit, cost
          center, location, …). After import, enable dimensions on Sources. Excel: first
          sheet only.
        </p>
        <pre className="mono mt-2 overflow-x-auto text-[11px]" style={{ color: "var(--fg)" }}>
{`Email
Project Worker
Business Unit
Team
Cost Center`}
        </pre>
      </details>
      {payload && (
        <p className="text-[13px]">
          Ready: <strong>{payload.fileName}</strong>
        </p>
      )}
      {previewText.trim() && (
        <>
          <textarea
            className="input min-h-[100px] w-full font-mono text-[12px]"
            value={previewText}
            onChange={(e) => {
              setPreviewText(e.target.value);
              setPayload((p) =>
                p
                  ? { fileName: p.fileName, content: e.target.value, base64: undefined }
                  : { fileName: "roster.csv", content: e.target.value }
              );
            }}
            readOnly={Boolean(payload?.base64)}
          />
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void importRoster()}
          >
            {busy ? "Uploading…" : "Upload people"}
          </button>
        </>
      )}
      {!previewText.trim() && (
        <p className="text-[12px]" style={{ color: "var(--muted)" }}>
          Choose a CSV or Excel file to preview — nothing uploads until you confirm.
        </p>
      )}
      {msg && (
        <p
          className="text-[13px]"
          style={{
            color: errors.length && !msg.startsWith("Added") ? "var(--danger)" : "var(--muted)",
          }}
        >
          {msg}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="space-y-1 text-[12px]" style={{ color: "var(--danger)" }}>
          {errors.slice(0, 8).map((e, i) => (
            <li key={i}>
              {e.row > 0 ? `Row ${e.row}: ` : ""}
              {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
