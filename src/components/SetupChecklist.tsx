import Link from "next/link";

export type SetupStep = {
  id: string;
  label: string;
  href: string;
  done: boolean;
};

/** Single Home onboarding card — replaces per-page pastel explainers. */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const allDone = steps.every((s) => s.done);
  if (allDone) return null;

  return (
    <div
      className="rounded-[var(--radius)] border px-4 py-4"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="text-[13px] font-semibold">Get set up</div>
      <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
        Three steps to a usable spend view.
      </p>
      <ol className="mt-4 space-y-2.5">
        {steps.map((step, i) => (
          <li key={step.id} className="flex items-center gap-3">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{
                background: step.done ? "rgba(31,122,69,0.12)" : "var(--panel-soft)",
                color: step.done ? "var(--success)" : "var(--muted)",
              }}
              aria-hidden
            >
              {step.done ? "✓" : i + 1}
            </span>
            {step.done ? (
              <span
                className="text-[14px]"
                style={{ color: "var(--muted)", textDecoration: "line-through" }}
              >
                {step.label}
              </span>
            ) : (
              <Link href={step.href} className="text-[14px] font-medium underline-offset-2 hover:underline">
                {step.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
