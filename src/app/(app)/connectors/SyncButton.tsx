"use client";

import { useState } from "react";

export function SyncButton({ provider }: { provider: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function sync() {
    setState("loading");
    try {
      const res = await fetch(`/api/connectors/${provider}/sync`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sync failed");
      setMsg(`${json.result?.rowsWritten ?? 0} rows`);
      setState("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn" type="button" onClick={sync} disabled={state === "loading"}>
        {state === "loading" ? "Syncing…" : "Run sync"}
      </button>
      {msg && (
        <span className="muted text-[11px]" style={{ color: state === "error" ? "var(--danger)" : undefined }}>
          {msg}
        </span>
      )}
    </div>
  );
}
