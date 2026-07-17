"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function AiCostActions({
  days,
  tools,
  teams,
}: {
  days: number;
  tools: string[];
  teams: { id: string; key: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    router.push(`/ai-cost?${sp.toString()}`);
  }

  async function sync(action: "demo" | "claude") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ai-tools/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setMsg(data.message || `Wrote ${data.written} rows`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-[12px]">
        Days
        <select
          className="select mt-1 block"
          value={String(days)}
          onChange={(e) => setParam("days", e.target.value)}
        >
          {[14, 30, 60, 90].map((d) => (
            <option key={d} value={d}>
              {d}d
            </option>
          ))}
        </select>
      </label>
      <label className="text-[12px]">
        Tool
        <select
          className="select mt-1 block"
          value={params.get("tool") ?? ""}
          onChange={(e) => setParam("tool", e.target.value)}
        >
          <option value="">All tools</option>
          {tools.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[12px]">
        Team
        <select
          className="select mt-1 block"
          value={params.get("team") ?? ""}
          onChange={(e) => setParam("team", e.target.value)}
        >
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => void sync("claude")}
      >
        Sync Claude / coding tools
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => void sync("demo")}
      >
        Demo sync
      </button>
      {msg && <span className="muted text-[12px]">{msg}</span>}
    </div>
  );
}
