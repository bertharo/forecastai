"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone } from "@/components/FileDropZone";

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
  const [dxFileName, setDxFileName] = useState("");
  const [dxBase64, setDxBase64] = useState<string | undefined>();
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
          action === "dx_csv"
            ? {
                action,
                csv:
                  dxBase64 && dxCsv.startsWith("(Excel")
                    ? undefined
                    : dxCsv || undefined,
                base64: dxBase64,
                fileName: dxFileName || "dx-metrics.csv",
              }
            : { action }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setMsg(data.message || `Wrote ${data.written} rows`);
      if (action === "dx_csv") {
        setDxCsv("");
        setDxBase64(undefined);
        setDxFileName("");
      }
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
        <h2 className="mb-1 text-sm font-semibold">GitHub pull requests</h2>
        <p className="muted mb-3 text-[13px]">
          So we can show “AI dollars per shipped change.” Connect GitHub, or load sample PRs
          for the demo.
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
            GitHub token (optional)
            <input
              className="input mt-1 block w-64"
              type="password"
              placeholder={github.hasToken ? "•••••••• (replace)" : "Paste token…"}
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
            Save token
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || !github.hasToken}
            onClick={() => void githubAction("sync")}
          >
            Pull latest
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void githubAction("demo")}
          >
            Load sample PRs
          </button>
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="mb-1 text-sm font-semibold">AI coding tools</h2>
        <p className="muted mb-3 text-[13px]">
          Pull spend from Claude, Cursor, and Copilot into AI cost — by person when we can
          match them.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void toolsSync("claude")}
          >
            Sync tools
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void toolsSync("demo")}
          >
            Load sample data
          </button>
          <a className="btn btn-ghost" href="/ai-cost">
            See AI cost →
          </a>
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="mb-1 text-sm font-semibold">Moving from DX?</h2>
        <p className="muted mb-3 text-[13px]">
          Drop or paste an export of daily AI tool spend (day, tool, email, team, dollars).
        </p>
        <FileDropZone
          disabled={busy}
          className="mb-3 min-h-[88px]"
          label={
            dxFileName
              ? `Ready: ${dxFileName}`
              : "Drop DX CSV/Excel here, or click to browse"
          }
          onFile={async (u) => {
            setDxFileName(u.fileName);
            setDxBase64(u.base64);
            if (u.content) setDxCsv(u.content);
            else setDxCsv(`(Excel “${u.fileName}” — first sheet imports on Import)`);
          }}
        />
        <textarea
          className="input w-full font-mono text-[12px]"
          rows={5}
          placeholder="Paste spreadsheet export…"
          value={dxCsv}
          onChange={(e) => {
            setDxCsv(e.target.value);
            setDxBase64(undefined);
            if (!dxFileName) setDxFileName("dx-metrics.csv");
          }}
          readOnly={Boolean(dxBase64 && dxCsv.startsWith("(Excel"))}
        />
        <button
          type="button"
          className="btn mt-2"
          disabled={busy || (!dxCsv.trim() && !dxBase64)}
          onClick={() => void toolsSync("dx_csv")}
        >
          Import
        </button>
      </div>

      {msg && <p className="muted text-[13px]">{msg}</p>}
    </div>
  );
}
