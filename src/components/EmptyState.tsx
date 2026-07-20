import Link from "next/link";
import type { ReactNode } from "react";

/** Small neutral empty state — icon + one sentence + one CTA. */
export function EmptyState({
  icon,
  message,
  action,
}: {
  icon?: ReactNode;
  message: string;
  action?: { href: string; label: string };
}) {
  return (
    <div
      className="flex flex-col items-start gap-3 rounded-[var(--radius-sm)] border px-4 py-5"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {icon ? (
        <span style={{ color: "var(--muted)" }} aria-hidden>
          {icon}
        </span>
      ) : null}
      <p className="text-[14px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {message}
      </p>
      {action ? (
        <Link href={action.href} className="btn">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
