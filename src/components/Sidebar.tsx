"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconAlerts,
  IconHome,
  IconOrgs,
  IconPlan,
  IconScenarios,
  IconSettings,
  IconSources,
} from "@/components/shell/icons";

const NAV = [
  { href: "/", label: "Home", icon: IconHome, match: (p: string) => p === "/" || p.startsWith("/?"), exact: true },
  { href: "/onboarding", label: "Orgs", icon: IconOrgs },
  { href: "/budgets", label: "Plan", icon: IconPlan },
  { href: "/scenarios", label: "Scenarios", icon: IconScenarios },
  { href: "/connectors", label: "Sources", icon: IconSources },
  { href: "/allocation", label: "Alerts", icon: IconAlerts },
  { href: "/price-cards", label: "Settings", icon: IconSettings },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (href === "/") return pathname === "/";
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  currentOrg,
}: {
  orgs?: { id: string; name: string; slug: string }[];
  currentOrg?: { id: string; name: string; slug: string } | null;
}) {
  const pathname = usePathname();

  return (
    <aside
      className="sticky top-0 m-3 flex h-[calc(100vh-1.5rem)] w-[220px] shrink-0 flex-col rounded-[1.75rem] p-3"
      style={{ background: "var(--sidebar)" }}
    >
      <div className="mb-6 flex items-center gap-2.5 px-2 pt-2">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ background: "#12141a" }}
          aria-hidden
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2.5 L13 8 L8 13.5 L3 8 Z" fill="white" />
          </svg>
        </div>
        <div>
          <div className="text-[15px] font-bold tracking-tight">Meter</div>
          <div className="text-[11px]" style={{ color: "var(--muted)" }}>
            {currentOrg?.name ?? "Spend intelligence"}
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="nav-link"
              data-active={active}
            >
              <Icon />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div
        className="mt-auto rounded-2xl p-3.5"
        style={{ background: "var(--panel)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
      >
        <div className="text-[13px] font-semibold">Q3 plan lock</div>
        <p className="mt-1 text-[12px] leading-snug" style={{ color: "var(--muted)" }}>
          5 days remaining. 3 decisions still pending your sign-off.
        </p>
      </div>
    </aside>
  );
}
