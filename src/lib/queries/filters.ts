export type MetricMode = "spend" | "consumption" | "adoption";

export type AnalyticsFilters = {
  dim?: string;
  node?: string;
  provider?: string;
  model?: string;
  feature?: string;
  metric?: MetricMode;
};

export function parseAnalyticsFilters(
  sp: Record<string, string | string[] | undefined>
): AnalyticsFilters {
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const metric = one("metric");
  return {
    dim: one("dim") || undefined,
    node: one("node") || undefined,
    provider: one("provider") || undefined,
    model: one("model") || undefined,
    feature: one("feature") || undefined,
    metric:
      metric === "consumption" || metric === "adoption" || metric === "spend"
        ? metric
        : "spend",
  };
}
