"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Local tabs for the Plan section (Budgets + Forecast) — never duplicate sidebar destinations. */
const TABS = [
  { href: "/budgets", label: "Budgets" },
  { href: "/forecast", label: "Forecast" },
];

export function PlanTabs() {
  const pathname = usePathname();

  if (pathname !== "/budgets" && pathname !== "/forecast") return null;

  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className="pill-tab"
          data-active={pathname === t.href}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
