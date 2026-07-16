"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Spend" },
  { href: "/forecast", label: "Forecast" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/model-switch", label: "Model Switch" },
  { href: "/price-cards", label: "Price Cards" },
  { href: "/budgets", label: "Budgets" },
  { href: "/connectors", label: "Connectors" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside
        className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
      >
        <div className="border-b px-4 py-5" style={{ borderColor: "var(--border)" }}>
          <div className="text-lg font-semibold tracking-tight" style={{ color: "var(--text)" }}>
            Meter
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
            Spend intelligence
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                data-active={active}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t p-3 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
          Northstar Analytics
          <div className="mono mt-1">demo org</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-5">{children}</main>
    </div>
  );
}
