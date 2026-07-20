"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Danger-zone delete for the current (or a named) workspace — requires confirm. */
export function DeleteWorkspaceButton({
  orgId,
  orgName,
  label = "Delete workspace",
  className = "btn btn-ghost",
  onDeleted,
}: {
  orgId: string;
  orgName: string;
  label?: string;
  className?: string;
  /** Called after a successful delete (list refresh, etc.). */
  onDeleted?: (nextOrgId: string | null) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function remove() {
    const ok = window.confirm(
      `Are you sure you want to delete “${orgName}”?\n\nThis permanently removes all spend, roster, sources, budgets, and settings in this workspace. This cannot be undone.`
    );
    if (!ok) return;

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, confirmed: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete workspace");
      }
      onDeleted?.(data.currentOrgId ?? null);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={className}
        disabled={busy}
        style={{ color: "var(--danger)" }}
        onClick={() => void remove()}
      >
        {busy ? "Deleting…" : label}
      </button>
      {msg && (
        <p className="text-[12px]" style={{ color: "var(--danger)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}
