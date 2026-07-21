export function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full"
      style={{ background: "var(--panel-soft)" }}
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${clamped}%`, background: "var(--accent)" }}
      />
    </div>
  );
}
