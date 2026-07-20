"use client";

import { useRef, useState, type ReactNode } from "react";
import { readUploadPayload } from "@/lib/import/uploadClient";

const ACCEPT =
  ".csv,text/csv,.txt,.xlsx,.xls,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type DroppedUpload = {
  fileName: string;
  content?: string;
  base64?: string;
  file: File;
};

/**
 * Click-to-browse + drag-and-drop zone for CSV / Excel uploads.
 */
export function FileDropZone({
  onFile,
  label = "Drop a CSV or Excel file here, or click to browse",
  hint,
  disabled,
  className = "",
  children,
}: {
  onFile: (upload: DroppedUpload) => void | Promise<void>;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file || disabled || busy) return;
    setBusy(true);
    try {
      const payload = await readUploadPayload(file);
      await onFile({ ...payload, file });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-center text-[13px] transition-colors ${className}`}
      style={{
        borderColor: dragging ? "#2f5bd8" : "var(--border-strong)",
        background: dragging ? "rgba(47,91,216,0.06)" : undefined,
        color: "var(--muted)",
        opacity: disabled || busy ? 0.6 : 1,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        void handleFile(f);
      }}
      onClick={() => {
        if (!disabled && !busy) inputRef.current?.click();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        disabled={disabled || busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          void handleFile(f);
        }}
      />
      {children ?? (
        <>
          <div className="text-[15px] font-medium" style={{ color: "var(--fg)" }}>
            {busy ? "Reading file…" : label}
          </div>
          {hint && <p className="max-w-md text-[12px]">{hint}</p>}
          <p className="text-[11px]">Accepts .csv · .xlsx · .xls · .xlsm</p>
        </>
      )}
    </div>
  );
}
