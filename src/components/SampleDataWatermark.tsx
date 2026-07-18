export function SampleDataWatermark({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex justify-center px-4"
      aria-hidden
    >
      <div
        className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] shadow-sm"
        style={{
          background: "rgba(18, 20, 26, 0.82)",
          color: "#f4f5f7",
          letterSpacing: "0.12em",
        }}
      >
        Sample data
      </div>
    </div>
  );
}
