"use client";

import { useState } from "react";
import type { MetricResult } from "@/lib/metrics/compute";
import { formatTrace } from "@/lib/metrics/compute";

export function Metric({
  metric,
  format = (v) => String(v),
  className,
}: {
  metric: MetricResult;
  format?: (v: number) => string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const stale =
    Date.now() - new Date(metric.trace.freshness).getTime() > 24 * 3600_000;

  return (
    <div className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        className="text-left"
        onClick={() => setOpen((o) => !o)}
        title="Show calculation provenance"
      >
        <span className="kpi" style={{ fontSize: "inherit" }}>
          {format(metric.value)}
        </span>
        {stale && (
          <span className="ml-1 text-[10px]" style={{ color: "var(--warning)" }}>
            stale
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute left-0 z-30 mt-2 w-80 rounded-xl border p-3 text-[12px] shadow-lg"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <div className="mb-1 font-semibold">Provenance</div>
          <p className="leading-relaxed" style={{ color: "#3a4050" }}>
            {metric.trace.formula}
          </p>
          <ul className="mt-2 space-y-1 mono text-[11px]">
            {metric.trace.inputs.map((i) => (
              <li key={i.name}>
                {i.name}: {String(i.value)}
                {i.unit ? ` ${i.unit}` : ""}
              </li>
            ))}
          </ul>
          <p className="muted mt-2 text-[11px]">
            {metric.trace.window.from} → {metric.trace.window.to}
          </p>
          {metric.trace.notes?.length ? (
            <p className="mt-1 text-[11px]" style={{ color: "var(--warning)" }}>
              {metric.trace.notes.join(" · ")}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost mt-2 text-[11px]"
            onClick={() => {
              void navigator.clipboard.writeText(formatTrace(metric.trace));
            }}
          >
            Copy trace
          </button>
        </div>
      )}
    </div>
  );
}
