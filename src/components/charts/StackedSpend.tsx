"use client";

import { ClientOnly } from "@/components/ClientOnly";
import { StackedSpendInner } from "./StackedSpendInner";

export function StackedSpend(props: {
  data: Record<string, string | number>[];
  keys: string[];
}) {
  return (
    <ClientOnly fallback={<div className="flex h-64 items-center muted">Loading chart…</div>}>
      <StackedSpendInner {...props} />
    </ClientOnly>
  );
}
