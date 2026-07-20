"use client";

/**
 * Legacy shell — app uses Sidebar + TopBar in (app)/layout.
 * Kept for any isolated demos; do not add a second nav here.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return <main className="min-w-0 flex-1 p-5">{children}</main>;
}
