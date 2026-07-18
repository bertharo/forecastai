"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RosterImport() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onFile(file: File) {
    setCsv(await file.text());
    setMsg(null);
  }

  async function importRoster() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/roster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setMsg(`Added ${data.upserted} people`);
      setCsv("");
      router.refresh();
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
            accept=".csv,text/csv"
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
        <p className="mt-2 mono text-[11px]">
          email, display_name, department, cost_center, employment_status, started_on,
          ended_on, team_key
        </p>
      </details>
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
          Or paste CSV here after choosing a file — nothing uploads until you confirm.
        </p>
      )}
      {msg && (
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
