"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RosterImport() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);

  async function onFile(file: File) {
    setCsv(await file.text());
    setFileName(file.name);
    setMsg(null);
    setErrors([]);
  }

  async function importRoster() {
    setBusy(true);
    setMsg(null);
    setErrors([]);
    try {
      const res = await fetch("/api/roster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");

      const errList = (data.errors ?? []) as { row: number; message: string }[];
      setErrors(errList);

      if (data.upserted > 0) {
        setMsg(
          `Added ${data.upserted} people` +
            (data.skipped ? ` · skipped ${data.skipped}` : "")
        );
        setCsv("");
        setFileName("");
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
          Upload a list of employees (email + department). We use email to put spend on
          the right department — you don’t need a department column on the bill file.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="btn cursor-pointer text-[13px]">
          Choose spreadsheet
          <input
            type="file"
            accept=".csv,text/csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </label>
        <a className="btn btn-ghost text-[13px]" href="/fixtures/hris-roster.csv">
          Download example
        </a>
      </div>
      <details className="text-[12px]" style={{ color: "var(--muted)" }}>
        <summary className="cursor-pointer">What columns do I need?</summary>
        <p className="mt-2">
          Required: <strong>email</strong> (or Work Email). Helpful: name, department,
          cost center, employment status, start/end dates, team.
        </p>
        <p className="mt-1 mono text-[11px]">
          email, display_name, department, cost_center, employment_status, started_on,
          ended_on, team_key
        </p>
      </details>
      {fileName && (
        <p className="text-[13px]">
          Ready: <strong>{fileName}</strong>
        </p>
      )}
      {csv.trim() && (
        <>
          <textarea
            className="input min-h-[100px] w-full font-mono text-[12px]"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
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
      {!csv.trim() && (
        <p className="text-[12px]" style={{ color: "var(--muted)" }}>
          Choose a CSV to preview — nothing uploads until you confirm.
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
