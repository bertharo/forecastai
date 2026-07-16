import { NextRequest, NextResponse } from "next/server";
import { modelSwitchDelta, type PriceLine, type RouteSplit } from "@/lib/forecast/engine";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const t0 = new Date("2025-01-01");
  const lines: PriceLine[] = body.priceLines ?? [
    { skuId: "claude-sonnet-4", meterKey: "input_tokens", unitPrice: 2.5 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-sonnet-4", meterKey: "output_tokens", unitPrice: 12 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-haiku-3.5", meterKey: "input_tokens", unitPrice: 0.8 / 1e6, effectiveFrom: t0, effectiveTo: null },
    { skuId: "claude-haiku-3.5", meterKey: "output_tokens", unitPrice: 4 / 1e6, effectiveFrom: t0, effectiveTo: null },
  ];

  // Revive dates if serialized
  const priceLines = lines.map((l: PriceLine & { effectiveFrom: string | Date }) => ({
    ...l,
    effectiveFrom: new Date(l.effectiveFrom),
    effectiveTo: l.effectiveTo ? new Date(l.effectiveTo) : null,
  }));

  const result = modelSwitchDelta({
    requests: body.requests ?? 100_000,
    baselineRoutes: body.baselineRoutes as RouteSplit[],
    targetRoutes: body.targetRoutes as RouteSplit[],
    priceLines,
    at: body.at ? new Date(body.at) : new Date(),
  });

  return NextResponse.json(result);
}
