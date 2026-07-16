"use client";

import { ClientOnly } from "@/components/ClientOnly";
import { FanChartInner } from "./FanChartInner";

export function FanChart(props: {
  data: { day: string; p10: number; p50: number; p90: number }[];
  budget?: number;
}) {
  return (
    <ClientOnly fallback={<div className="flex h-72 items-center muted">Loading chart…</div>}>
      <FanChartInner {...props} />
    </ClientOnly>
  );
}
