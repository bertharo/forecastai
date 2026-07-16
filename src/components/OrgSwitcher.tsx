"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function OrgSwitcher({
  orgs,
  currentOrgId,
}: {
  orgs: { id: string; name: string; slug: string }[];
  currentOrgId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (orgs.length === 0) {
    return (
      <a href="/onboarding" className="px-2 text-[13px] font-medium">
        Create org →
      </a>
    );
  }

  return (
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
      aria-label="Organization"
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
