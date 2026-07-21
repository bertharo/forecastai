"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone } from "@/components/FileDropZone";
import { rowsToCsv, safeJsonResponse } from "@/lib/import/uploadClient";

export function ContributorsPanel({ count }: { count: number }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [base64, setBase64] = useState<string | undefined>();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [github, setGithub] = useState("");
  const [teamKey, setTeamKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function upsertOne() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/contributors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          email,
          displayName: name || email,
          githubLogin: github || undefined,
          teamKey: teamKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMsg(`Saved ${data.contributor.email}`);
      setEmail("");
      setName("");
      setGithub("");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importFile() {
    setBusy(true);
    setMsg(null);
    try {
      // Prefer full roster importer (handles email + arbitrary attribute columns + Excel)
      const res = await fetch("/api/roster", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: csv || undefined,
          base64,
          fileName: fileName || "people.csv",
        }),
      });
      const data = await safeJsonResponse(res);
      if (!res.ok) throw new Error((data.message as string) || (data.error as string) || "Failed");
      setMsg(`Upserted ${data.upserted} people`);
      setCsv("");
      setBase64(undefined);
      setFileName("");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel p-4">
      <h2 className="mb-1 text-sm font-semibold">People on your team</h2>
      <p className="muted mb-3 text-[13px]">
        Who uses AI tools — so spend can land on the right person and team.{" "}
        <strong>{count}</strong> added. Drop a CSV/Excel or paste rows (email, name,
        and any org attributes). Enable dimensions below after import.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-[12px]">
          Email
          <input
            className="input mt-1 block w-48"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="text-[12px]">
          Name
          <input
            className="input mt-1 block w-40"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-[12px]">
          GitHub
          <input
            className="input mt-1 block w-32"
            value={github}
            onChange={(e) => setGithub(e.target.value)}
          />
        </label>
        <label className="text-[12px]">
          Team key
          <input
            className="input mt-1 block w-32"
            placeholder="ai-platform"
            value={teamKey}
            onChange={(e) => setTeamKey(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={busy || !email.trim()}
          onClick={() => void upsertOne()}
        >
          Add
        </button>
      </div>

      <FileDropZone
        disabled={busy}
        className="mb-3 min-h-[88px]"
        label={
          fileName
            ? `Ready: ${fileName}`
            : "Drop people CSV/Excel here, or click to browse"
        }
        onFile={async (u) => {
          setFileName(u.fileName);
          setBase64(u.base64);
          if (u.content) {
            setCsv(u.content);
          } else if (u.base64) {
            // Preview path: ask import API for rows, show as CSV text
            const res = await fetch("/api/import", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "preview",
                fileName: u.fileName,
                base64: u.base64,
                sourceKind: "excel",
              }),
            });
            const data = await safeJsonResponse(res);
            if (res.ok && data.headers && data.preview) {
              const allRows = data.preview as Record<string, string>[];
              const rowCount = Number(data.rowCount ?? 0);
              // preview is only 50 rows — still keep base64 for full upload
              setCsv(
                rowsToCsv(data.headers as string[], allRows) +
                  (rowCount > allRows.length
                    ? `\n… (${rowCount} rows total — full file uploads on Import)`
                    : "")
              );
            } else {
              setCsv(`(Excel “${u.fileName}” — will import first sheet on Upload)`);
            }
          }
        }}
      />

      <textarea
        className="input w-full font-mono text-[12px]"
        rows={4}
        placeholder="email,display_name,github_login,team_key"
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setBase64(undefined);
          if (!fileName) setFileName("people.csv");
        }}
        readOnly={Boolean(base64 && csv.startsWith("(Excel"))}
      />
      <button
        type="button"
        className="btn btn-ghost mt-2"
        disabled={busy || (!csv.trim() && !base64)}
        onClick={() => void importFile()}
      >
        {busy ? "Uploading…" : "Import people"}
      </button>
      {msg && <p className="muted mt-2 text-[13px]">{msg}</p>}
    </div>
  );
}
