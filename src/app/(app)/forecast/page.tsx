import { FanChart } from "@/components/charts/FanChart";
import { DataTable } from "@/components/DataTable";
import { Money } from "@/components/Money";
import { getDemoOrg } from "@/lib/queries/org";
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

export default async function ForecastPage() {
  const org = await getDemoOrg();
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

  const { features, lines } = demoTree();
  const forecast = projectForecast({
    start: new Date(),
    horizonDays: 180,
    tree: { features },
    priceLines: lines,
    adoptionByFeature: {
      support_copilot: {
        curve: "logistic",
        current: 0.28,
        target: 0.45,
        weeksToSaturation: 26,
      },
      doc_qa: {
        curve: "linear",
        current: 0.4,
        target: 0.55,
        weeksToSaturation: 20,
      },
    },
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Forecast</h1>
        <p className="muted mt-1">
          Driver tree × price cards × commitments — P10 / P50 / P90, never a single point
        </p>
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
          rows={drivers.map((d) => ({
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
