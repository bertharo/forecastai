"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoadSampleButton({
  label = "Load sample data",
  className = "btn",
  /** When true, warn that existing imports/spend will be replaced. */
  replaceExisting = false,
}: {
  label?: string;
  className?: string;
  replaceExisting?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (replaceExisting) {
      const ok = window.confirm(
        "Replace all spend, roster, keys, and past uploads in this workspace with the clean sample pack?"
      );
      if (!ok) return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/finops-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace: replaceExisting, action: "load" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to load sample");
      setMsg(
        `Loaded ${data.roster} people · ${data.terminatedWithSeats} terminated seats · ${data.unmappedKeys} unmapped keys`
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className={className} disabled={busy} onClick={() => void load()}>
        {busy ? "Loading sample…" : label}
      </button>
      {msg && (
        <p className="text-[12px]" style={{ color: "var(--muted)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
