"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function OrgSwitcher({
  orgs,
  currentOrgId,
}: {
  orgs: { id: string; name: string; slug: string; isPrivate?: boolean }[];
  currentOrgId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (orgs.length === 0) {
    return (
      <a href="/onboarding" className="px-2 text-[13px] font-medium">
        Open a workspace →
      </a>
    );
  }

  return (
    <label className="flex items-center gap-2 px-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        Workspace
      </span>
      <select
        className="border-0 bg-transparent py-1.5 pr-6 text-[13px] font-medium outline-none"
        disabled={pending}
        value={currentOrgId ?? orgs[0]?.id}
        onChange={(e) => {
          const id = e.target.value;
          start(async () => {
            await fetch("/api/orgs/switch", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ orgId: id }),
            });
            router.refresh();
          });
        }}
        aria-label="Workspace"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.isPrivate ? `${o.name} (private)` : o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
