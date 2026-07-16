import { NextRequest, NextResponse } from "next/server";
import { projectForecast, type FeatureDrivers, type PriceLine } from "@/lib/forecast/engine";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const t0 = new Date("2025-01-01");
  const lines: PriceLine[] = [
    { skuId: "claude-sonnet-4", meterKey: "input_tokens", unitPrice: 2.5 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-sonnet-4", meterKey: "output_tokens", unitPrice: 12 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-haiku-3.5", meterKey: "input_tokens", unitPrice: 0.8 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-haiku-3.5", meterKey: "output_tokens", unitPrice: 4 / 1e6, effectiveFrom: t0, effectiveTo: null },
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
  ];

  const days = projectForecast({
    start: new Date(),
    horizonDays: body.horizonDays ?? 90,
    tree: { features },
    priceLines: lines,
    adoptionByFeature: body.adoptionByFeature,
  });

  return NextResponse.json({
    days: days.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      p10: d.p10,
      p50: d.p50,
      p90: d.p90,
      drivers: d.drivers,
    })),
  });
}
