"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoadSampleButton({
  label = "Load sample data",
  className = "btn",
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/finops-sample", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load sample");
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
