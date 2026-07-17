"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CodingToolsPanel({
  github,
}: {
  github: {
    status: string | null;
    accountLogin: string | null;
    lastSyncedAt: string | null;
    prCount: number;
    hasToken: boolean;
  };
}) {
  const router = useRouter();
  const [pat, setPat] = useState("");
  const [dxCsv, setDxCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function githubAction(action: "connect" | "sync" | "demo") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/scm/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "connect"
            ? { action, token: pat }
            : action === "demo"
              ? { action: "demo" }
              : { action: "sync" }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "GitHub action failed");
      setMsg(
        action === "connect"
          ? "GitHub PAT saved"
          : `Synced ${data.written ?? 0} PRs`
      );
      setPat("");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toolsSync(action: "demo" | "claude" | "dx_csv") {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ai-tools/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "dx_csv" ? { action, csv: dxCsv } : { action }
        ),
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
    <div className="space-y-3">
      <div className="panel p-4">
        <h2 className="mb-1 text-sm font-semibold">GitHub (merged PRs)</h2>
        <p className="muted mb-3 text-[13px]">
          Join AI spend to delivery — cost per merged PR. Paste a classic PAT with{" "}
          <span className="mono">repo</span> read, or load demo PRs.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
          <div>
            <div className="muted text-[10px] uppercase">Status</div>
            <div>{github.status ?? "disconnected"}</div>
          </div>
          <div>
            <div className="muted text-[10px] uppercase">Account</div>
            <div>{github.accountLogin ?? "—"}</div>
          </div>
          <div>
            <div className="muted text-[10px] uppercase">Last sync</div>
            <div className="mono">
              {github.lastSyncedAt
                ? github.lastSyncedAt.slice(0, 16).replace("T", " ")
                : "—"}
            </div>
          </div>
          <div>
            <div className="muted text-[10px] uppercase">Merged PRs</div>
            <div className="mono">{github.prCount}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[12px]">
            Personal access token
            <input
              className="input mt-1 block w-64"
              type="password"
              placeholder={github.hasToken ? "•••••••• (replace)" : "ghp_…"}
              value={pat}
              onChange={(e) => setPat(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || !pat.trim()}
            onClick={() => void githubAction("connect")}
          >
            Save PAT
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || !github.hasToken}
            onClick={() => void githubAction("sync")}
          >
            Sync live
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void githubAction("demo")}
          >
            Demo PRs
          </button>
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="mb-1 text-sm font-semibold">Coding tools (Claude / Cursor / Copilot)</h2>
        <p className="muted mb-3 text-[13px]">
          Per-person daily grains for AI Cost. Uses Anthropic Admin key when set;
          otherwise demo attribution by contributor.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void toolsSync("claude")}
          >
            Sync Claude / tools
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void toolsSync("demo")}
          >
            Demo sync
          </button>
          <a className="btn btn-ghost" href="/ai-cost">
            Open AI cost →
          </a>
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="mb-1 text-sm font-semibold">Import DX AI metrics CSV</h2>
        <p className="muted mb-3 text-[13px]">
          Columns:{" "}
          <span className="mono">
            day, tool, email, display_name, team_key, spend, tokens_in, tokens_out,
            sessions
          </span>
          . Template fixture under{" "}
          <span className="mono">fixtures/dx-ai-metrics.csv</span>.
        </p>
        <textarea
          className="input w-full font-mono text-[12px]"
          rows={5}
          placeholder="Paste DX export CSV…"
          value={dxCsv}
          onChange={(e) => setDxCsv(e.target.value)}
        />
        <button
          type="button"
          className="btn mt-2"
          disabled={busy || !dxCsv.trim()}
          onClick={() => void toolsSync("dx_csv")}
        >
          Import DX CSV
        </button>
      </div>

      {msg && <p className="muted text-[13px]">{msg}</p>}
    </div>
  );
}
