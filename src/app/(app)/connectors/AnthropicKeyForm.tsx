"use client";

import { useState } from "react";

export function AnthropicKeyForm() {
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (demoMode: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/connectors/anthropic/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(demoMode ? { demoMode: true } : { apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setMsg(
        demoMode
          ? "Demo mode enabled (mock sync)."
          : "Admin key saved encrypted. Run Sync or Backfill."
      );
      setApiKey("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sync = async (phase: "incremental" | "backfill") => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/connectors/anthropic/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase,
          backfillDays: phase === "backfill" ? 365 : 7,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "sync failed");
      setMsg(
        `${phase}: wrote ${data.persisted?.written ?? data.result?.rowsWritten ?? 0} usage events`
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel space-y-3 p-4">
      <h2 className="text-sm font-medium">Anthropic Admin API (Tier 1 live)</h2>
      <p className="muted text-[12px]">
        Paste an org admin key (encrypted at rest with{" "}
        <span className="mono">METER_CREDENTIALS_KEY</span>). Demo org can stay on mock.
      </p>
      <input
        className="select w-full mono"
        type="password"
        placeholder="sk-ant-admin-…"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={busy || !apiKey}
          onClick={() => void save(false)}
        >
          Save key
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void save(true)}>
          Use demo mock
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void sync("incremental")}
        >
          Sync 7d
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void sync("backfill")}
        >
          Backfill 12mo
        </button>
      </div>
      {msg && <p className="text-[12px]">{msg}</p>}
    </div>
  );
}
