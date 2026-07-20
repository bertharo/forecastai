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

/** Wipe sample pack without reloading — frees the workspace for real CSV/Excel uploads. */
export function ClearSampleButton({
  label = "Clear sample data",
  className = "btn btn-ghost",
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function clear() {
    const ok = window.confirm(
      "Clear the sample pack from this workspace? Spend, roster, keys, and uploads from the sample will be removed so you can import your own files."
    );
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/finops-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to clear sample");
      setMsg("Sample cleared — you can upload spreadsheets now.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className={className} disabled={busy} onClick={() => void clear()}>
        {busy ? "Clearing…" : label}
      </button>
      {msg && (
        <p className="text-[12px]" style={{ color: "var(--muted)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
