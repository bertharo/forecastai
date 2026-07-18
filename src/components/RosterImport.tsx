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
      setMsg(`Upserted ${data.upserted} people from roster`);
      setCsv("");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="roster" className="soft-card space-y-3">
      <div>
        <h2 className="text-sm font-semibold">HRIS roster</h2>
        <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
          Upload people with email, department, cost center, and employment status.
          Department spend joins usage rows on email — not from the usage CSV.
        </p>
      </div>
      <p className="mono text-[11px]" style={{ color: "var(--muted)" }}>
        email, display_name, department, cost_center, employment_status, started_on,
        ended_on, team_key
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="btn btn-ghost cursor-pointer text-[13px]">
          Choose CSV
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
          Download template
        </a>
      </div>
      <textarea
        className="input min-h-[120px] w-full font-mono text-[12px]"
        placeholder="Paste HRIS CSV…"
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
      />
      <button
        type="button"
        className="btn"
        disabled={busy || !csv.trim()}
        onClick={() => void importRoster()}
      >
        {busy ? "Importing…" : "Import roster"}
      </button>
      {msg && (
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
