"use client";

import { useCallback, useEffect, useState } from "react";

type KeyRow = {
  id: string;
  label: string;
  keyPrefix: string;
  envTag: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export function OtelKeysPanel() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [label, setLabel] = useState("Staging ingest");
  const [envTag, setEnvTag] = useState("staging");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/otel/keys");
    const data = await res.json();
    setKeys(data.keys ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (rotateFromId?: string) => {
    setBusy(true);
    setFreshKey(null);
    try {
      const res = await fetch("/api/otel/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, envTag, rotateFromId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setFreshKey(data.key);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this key?")) return;
    await fetch(`/api/otel/keys/${id}/revoke`, { method: "POST" });
    await load();
  };

  return (
    <div className="panel space-y-3 p-4">
      <h2 className="text-sm font-medium">OTel ingest keys</h2>
      <div className="flex flex-wrap gap-2">
        <input
          className="select"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label"
        />
        <select
          className="select"
          value={envTag}
          onChange={(e) => setEnvTag(e.target.value)}
        >
          <option value="prod">prod</option>
          <option value="staging">staging</option>
          <option value="dev">dev</option>
        </select>
        <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
          Create key
        </button>
      </div>
      {freshKey && (
        <pre
          className="mono overflow-auto p-2 text-[11px]"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        >
          Copy now — shown once:{"\n"}
          {freshKey}
        </pre>
      )}
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr style={{ color: "var(--muted)" }}>
            <th className="p-1">Label</th>
            <th className="p-1">Prefix</th>
            <th className="p-1">Env</th>
            <th className="p-1">Last used</th>
            <th className="p-1" />
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td className="p-1">
                {k.label}
                {k.revokedAt ? " (revoked)" : ""}
              </td>
              <td className="mono p-1">{k.keyPrefix}…</td>
              <td className="mono p-1">{k.envTag}</td>
              <td className="mono p-1">
                {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "—"}
              </td>
              <td className="space-x-1 p-1">
                {!k.revokedAt && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void create(k.id)}
                    >
                      Rotate
                    </button>
                    <button type="button" className="btn" onClick={() => void revoke(k.id)}>
                      Revoke
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
