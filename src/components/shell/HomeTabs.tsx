"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Local tabs for Home only — never duplicate sidebar destinations. */
const TABS = [
  {
    href: "/",
    label: "Brief",
    match: (p: string, tab: string | null) => p === "/" && (!tab || tab === "brief"),
  },
  {
    href: "/?tab=org",
    label: "By org",
    match: (p: string, tab: string | null) => p === "/" && tab === "org",
  },
  {
    href: "/?tab=breakdown",
    label: "Breakdown",
    match: (p: string, tab: string | null) => p === "/" && tab === "breakdown",
  },
];

export function HomeTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab");

  if (pathname !== "/") return null;

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
