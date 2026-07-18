"use client";

import { useEffect, useState } from "react";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { IconBell, IconSearch } from "@/components/shell/icons";

function greetingForHour(h: number): string {
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function TopBar({
  orgs = [],
  currentOrg,
}: {
  orgs?: { id: string; name: string; slug: string }[];
  currentOrg?: { id: string; name: string; slug: string } | null;
}) {
  const orgName = currentOrg?.name ?? "your org";
  // Stable on SSR + first client paint — avoid hydration mismatch from server UTC vs local hours
  const [greeting, setGreeting] = useState("Hello");

  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="page-title">
          {greeting}, Bert <span className="wave">👋</span>
        </h1>
        <p className="mt-1 text-[14px]" style={{ color: "var(--muted)" }}>
          {orgName} · here&apos;s where spend stands.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex items-center rounded-full border px-1 py-1 pl-3"
          style={{ borderColor: "var(--border-strong)", background: "var(--panel)" }}
        >
          <OrgSwitcher orgs={orgs} currentOrgId={currentOrg?.id} />
        </div>
        <label
          className="flex min-w-[220px] max-w-sm flex-1 items-center gap-2 rounded-full border px-3 py-2"
          style={{ borderColor: "var(--border-strong)", background: "var(--panel)" }}
        >
          <span style={{ color: "var(--muted)" }}>
            <IconSearch />
          </span>
          <input
            className="w-full bg-transparent text-[13px] outline-none"
            placeholder="Search workloads, teams, decisions…"
          />
        </label>
        <button
          type="button"
          className="relative flex h-10 w-10 items-center justify-center rounded-full border"
          style={{ borderColor: "var(--border-strong)", background: "var(--panel)" }}
          aria-label="Notifications"
        >
          <IconBell />
          <span
            className="absolute right-2 top-2 h-2 w-2 rounded-full"
            style={{ background: "var(--danger)" }}
          />
        </button>
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full text-[13px] font-semibold text-white"
          style={{ background: "#7c5cbf" }}
          aria-label="Bert Haro"
        >
          BH
        </div>
      </div>
    </header>
  );
}
