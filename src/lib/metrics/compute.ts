export type MetricTraceInput = {
  name: string;
  value: number | string | null;
  unit?: string;
};

export type MetricTrace = {
  formula: string;
  inputs: MetricTraceInput[];
  window: { from: string; to: string };
  filters: Record<string, string>;
  freshness: string; // ISO
  notes?: string[];
};

export type MetricResult = {
  value: number;
  trace: MetricTrace;
};

export function computeMetric(opts: {
  formula: string;
  value: number;
  inputs: MetricTraceInput[];
  window: { from: Date | string; to: Date | string };
  filters?: Record<string, string>;
  freshness?: Date;
  notes?: string[];
}): MetricResult {
  const from =
    typeof opts.window.from === "string"
      ? opts.window.from
      : opts.window.from.toISOString().slice(0, 10);
  const to =
    typeof opts.window.to === "string"
      ? opts.window.to
      : opts.window.to.toISOString().slice(0, 10);
  return {
    value: opts.value,
    trace: {
      formula: opts.formula,
      inputs: opts.inputs,
      window: { from, to },
      filters: opts.filters ?? {},
      freshness: (opts.freshness ?? new Date()).toISOString(),
      notes: opts.notes,
    },
  };
}

export function formatTrace(trace: MetricTrace): string {
  const inputs = trace.inputs
    .map((i) => `${i.name}=${i.value}${i.unit ? ` ${i.unit}` : ""}`)
    .join(", ");
  return `${trace.formula} · ${inputs} · ${trace.window.from}→${trace.window.to} · fresh ${trace.freshness}`;
}
