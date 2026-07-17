import { Suspense } from "react";
import { FanChart } from "@/components/charts/FanChart";
import { DataTable } from "@/components/DataTable";
import { FilterBar } from "@/components/FilterBar";
import { Money } from "@/components/Money";
import {
  getCurrentOrg,
  getDimensionNodes,
  getDimensionTypes,
} from "@/lib/queries/org";
import { parseAnalyticsFilters } from "@/lib/queries/filters";
import { getFilterOptions } from "@/lib/queries/spend";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { projectForecast, type FeatureDrivers, type PriceLine } from "@/lib/forecast/engine";

export const dynamic = "force-dynamic";

function demoTree(): { features: FeatureDrivers[]; lines: PriceLine[] } {
  const t0 = new Date("2025-01-01");
  const lines: PriceLine[] = [
    { skuId: "claude-sonnet-4", meterKey: "input_tokens", unitPrice: 2.5 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-sonnet-4", meterKey: "output_tokens", unitPrice: 12 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-haiku-3.5", meterKey: "input_tokens", unitPrice: 0.8 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-haiku-3.5", meterKey: "output_tokens", unitPrice: 4 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "gpt-4o", meterKey: "input_tokens", unitPrice: 2.5 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "gpt-4o", meterKey: "output_tokens", unitPrice: 10 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "gemini-2.5-flash", meterKey: "input_tokens", unitPrice: 0.15 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "gemini-2.5-flash", meterKey: "output_tokens", unitPrice: 0.6 / 1e6, effectiveFrom: t0, effectiveTo: null },
  ];
  const features: FeatureDrivers[] = [
    {
      featureKey: "support_copilot",
      weeklyActiveUsers: 4200,
      requestsPerActiveUser: 5.2,
      adoption: 0.28,
      residualCv: 0.18,
      routes: [
        { skuId: "claude-haiku-3.5", share: 0.8, avgInputTokens: 1800, avgOutputTokens: 420 },
        { skuId: "claude-sonnet-4", share: 0.2, avgInputTokens: 1800, avgOutputTokens: 420 },
      ],
    },
    {
      featureKey: "doc_qa",
      weeklyActiveUsers: 8000,
      requestsPerActiveUser: 3.1,
      adoption: 0.4,
      residualCv: 0.15,
      routes: [{ skuId: "gpt-4o", share: 1, avgInputTokens: 3200, avgOutputTokens: 600 }],
    },
    {
      featureKey: "code_assist",
      weeklyActiveUsers: 180,
      requestsPerActiveUser: 40,
      adoption: 0.55,
      residualCv: 0.12,
      routes: [{ skuId: "claude-sonnet-4", share: 1, avgInputTokens: 4500, avgOutputTokens: 1100 }],
    },
    {
      featureKey: "sales_email",
      weeklyActiveUsers: 600,
      requestsPerActiveUser: 8,
      adoption: 0.22,
      residualCv: 0.2,
      routes: [{ skuId: "gemini-2.5-flash", share: 1, avgInputTokens: 1200, avgOutputTokens: 800 }],
    },
  ];
  return { features, lines };
}

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseAnalyticsFilters(sp);
  const org = await getCurrentOrg();

  const [types, nodes, options] = org
    ? await Promise.all([
        getDimensionTypes(org.id),
        getDimensionNodes(org.id),
        getFilterOptions(org.id),
      ])
    : [[], [], { providers: [], models: [], features: [] }];

  const drivers = org
    ? await db
        .select()
        .from(s.drivers)
        .where(eq(s.drivers.orgId, org.id))
        .orderBy(asc(s.drivers.sortOrder))
    : [];

  const latestValues = org
    ? await db
        .select()
        .from(s.driverValues)
        .innerJoin(s.drivers, eq(s.driverValues.driverId, s.drivers.id))
        .where(eq(s.drivers.orgId, org.id))
        .orderBy(desc(s.driverValues.periodStart))
        .limit(40)
    : [];

  const valueByDriver = new Map<string, number>();
  for (const row of latestValues) {
    if (!valueByDriver.has(row.drivers.id)) {
      valueByDriver.set(row.drivers.id, Number(row.driver_values.value));
    }
  }

  const [budget] = org
    ? await db
        .select()
        .from(s.budgets)
        .where(eq(s.budgets.orgId, org.id))
        .limit(1)
    : [];

  let { features, lines } = demoTree();
  if (filters.feature) {
    features = features.filter((f) => f.featureKey === filters.feature);
  }
  if (filters.model) {
    features = features
      .map((f) => ({
        ...f,
        routes: f.routes.filter((r) => r.skuId === filters.model),
      }))
      .filter((f) => f.routes.length > 0);
  }
  if (features.length === 0) {
    features = demoTree().features;
  }

  const adoptionByFeature: Record<
    string,
    { curve: "logistic" | "linear"; current: number; target: number; weeksToSaturation: number }
  > = {};
  for (const f of features) {
    if (f.featureKey === "support_copilot") {
      adoptionByFeature[f.featureKey] = {
        curve: "logistic",
        current: f.adoption,
        target: 0.45,
        weeksToSaturation: 26,
      };
    } else {
      adoptionByFeature[f.featureKey] = {
        curve: "linear",
        current: f.adoption,
        target: Math.min(0.9, f.adoption + 0.15),
        weeksToSaturation: 20,
      };
    }
  }

  const forecast = projectForecast({
    start: new Date(),
    horizonDays: 180,
    tree: { features },
    priceLines: lines,
    adoptionByFeature,
  });

  const chartData = forecast
    .filter((_, i) => i % 3 === 0)
    .map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      p10: d.p10,
      p50: d.p50,
      p90: d.p90,
    }));

  const dailyBudget = budget ? Number(budget.amount) / 30 : undefined;
  const monthP50 = forecast.slice(0, 30).reduce((a, d) => a + d.p50, 0);

  const filteredDrivers = filters.feature
    ? drivers.filter((d) => d.featureKey === filters.feature)
    : drivers;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Forecast</h1>
          <p className="muted mt-1">
            {org?.name ?? "No org"} — driver tree × prices × adoption (filter by feature / model)
          </p>
        </div>
        <Suspense fallback={<div className="muted text-[12px]">Loading filters…</div>}>
          <FilterBar
            types={types.map((t) => ({
              id: t.id,
              key: t.key,
              displayName: t.displayName,
            }))}
            nodes={nodes.map((n) => ({
              id: n.id,
              key: n.key,
              displayName: n.displayName,
              dimensionTypeId: n.dimensionTypeId,
              parentId: n.parentId,
              path: n.path,
              costCenterCode: n.costCenterCode,
            }))}
            providers={options.providers}
            models={
              options.models.length
                ? options.models
                : [
                    { skuId: "claude-sonnet-4", name: "Claude Sonnet 4" },
                    { skuId: "claude-haiku-3.5", name: "Claude Haiku 3.5" },
                    { skuId: "gpt-4o", name: "GPT-4o" },
                    { skuId: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
                  ]
            }
            features={
              options.features.length
                ? options.features
                : demoTree().features.map((f) => ({ key: f.featureKey }))
            }
            showMetric={false}
          />
        </Suspense>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="panel p-3">
          <div className="muted text-[11px] uppercase">Next 30d P50</div>
          <div className="kpi mt-1">
            <Money value={monthP50} />
          </div>
        </div>
        <div className="panel p-3">
          <div className="muted text-[11px] uppercase">Next 30d P90</div>
          <div className="kpi mt-1">
            <Money value={forecast.slice(0, 30).reduce((a, d) => a + d.p90, 0)} />
          </div>
        </div>
        <div className="panel p-3">
          <div className="muted text-[11px] uppercase">Budget / day</div>
          <div className="kpi mt-1">
            {dailyBudget != null ? <Money value={dailyBudget} /> : "—"}
          </div>
        </div>
      </div>

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">Fan chart (180d)</h2>
        <FanChart data={chartData} budget={dailyBudget} />
      </div>

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">Fitted driver tree</h2>
        <p className="muted mb-3 text-[12px]">
          Decomposition is the product insight — edit drivers in scenarios to recompute the fan.
        </p>
        <DataTable
          columns={[
            { key: "name", label: "Driver" },
            { key: "feature", label: "Feature" },
            { key: "unit", label: "Unit" },
            { key: "value", label: "Latest fitted", align: "right" },
          ]}
          rows={filteredDrivers.map((d) => ({
            name: d.displayName,
            feature: d.featureKey ?? "org",
            unit: d.unit,
            value: (valueByDriver.get(d.id) ?? 0).toLocaleString(undefined, {
              maximumFractionDigits: 3,
            }),
          }))}
        />
      </div>
    </div>
  );
}
