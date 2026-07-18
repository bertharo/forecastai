"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  { href: "/", label: "Brief", match: (p: string, tab: string | null) => p === "/" && (!tab || tab === "brief") },
  { href: "/?tab=org", label: "By org", match: (p: string, tab: string | null) => p === "/" && tab === "org" },
  {
    href: "/?tab=breakdown",
    label: "Breakdown",
    match: (p: string, tab: string | null) => p === "/" && tab === "breakdown",
  },
  {
    href: "/ai-cost",
    label: "AI cost",
    match: (p: string) => p.startsWith("/ai-cost"),
  },
  {
    href: "/scenarios",
    label: "Model a change",
    match: (p: string) => p.startsWith("/scenarios") || p.startsWith("/model-switch"),
  },
  {
    href: "/connectors",
    label: "Data & sources",
    match: (p: string) =>
      p.startsWith("/connectors") || p.startsWith("/import"),
  },
  {
    href: "/keys",
    label: "Keys",
    match: (p: string) => p.startsWith("/keys"),
  },
];

export function HomeTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab");

  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {TABS.map((t) => {
        const active = t.match(pathname, tab);
        return (
          <Link key={t.label} href={t.href} className="pill-tab" data-active={active}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
