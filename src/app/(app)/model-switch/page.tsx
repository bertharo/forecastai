"use client";

import { useMemo, useState } from "react";
import { Money } from "@/components/Money";
import { modelSwitchDelta, type PriceLine, type RouteSplit } from "@/lib/forecast/engine";

const LINES: PriceLine[] = [
  { skuId: "claude-sonnet-4", meterKey: "input_tokens", unitPrice: 2.5 / 1e6, effectiveFrom: new Date("2025-01-01"), effectiveTo: null },
  { skuId: "claude-sonnet-4", meterKey: "output_tokens", unitPrice: 12 / 1e6, effectiveFrom: new Date("2025-01-01"), effectiveTo: null },
  { skuId: "claude-haiku-3.5", meterKey: "input_tokens", unitPrice: 0.8 / 1e6, effectiveFrom: new Date("2025-01-01"), effectiveTo: null },
  { skuId: "claude-haiku-3.5", meterKey: "output_tokens", unitPrice: 4 / 1e6, effectiveFrom: new Date("2025-01-01"), effectiveTo: null },
  { skuId: "gpt-4o", meterKey: "input_tokens", unitPrice: 2.5 / 1e6, effectiveFrom: new Date("2025-01-01"), effectiveTo: null },
  { skuId: "gpt-4o", meterKey: "output_tokens", unitPrice: 10 / 1e6, effectiveFrom: new Date("2025-01-01"), effectiveTo: null },
];

export default function ModelSwitchPage() {
  const [feature, setFeature] = useState("support_copilot");
  const [haikuShare, setHaikuShare] = useState(80);
  const [verbosity, setVerbosity] = useState(1.05);
  const [requests, setRequests] = useState(126_000);
  const [quality, setQuality] = useState("Acceptable for L1 triage; escalate complex tickets to Sonnet");
  const [latency, setLatency] = useState("Expect Haiku p95 ~40% faster on simple turns");

  const result = useMemo(() => {
    const baseline: RouteSplit[] = [
      { skuId: "claude-sonnet-4", share: 1, avgInputTokens: 1800, avgOutputTokens: 420 },
    ];
    const target: RouteSplit[] = [
      {
        skuId: "claude-haiku-3.5",
        share: haikuShare / 100,
        avgInputTokens: 1800,
        avgOutputTokens: 420,
        verbosityMultiplier: verbosity,
      },
      {
        skuId: "claude-sonnet-4",
        share: 1 - haikuShare / 100,
        avgInputTokens: 1800,
        avgOutputTokens: 420,
      },
    ];
    return modelSwitchDelta({
      requests,
      baselineRoutes: baseline,
      targetRoutes: target,
      priceLines: LINES,
      at: new Date(),
    });
  }, [haikuShare, verbosity, requests]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Model Switch Simulator</h1>
        <p className="muted mt-1">
          Replay workload against alternate routing — cost delta is computed; quality/latency are your assumptions
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel space-y-4 p-4">
          <label className="block">
            <span className="muted text-[11px] uppercase">Feature / workload</span>
            <select className="select mt-1 w-full" value={feature} onChange={(e) => setFeature(e.target.value)}>
              <option value="support_copilot">support_copilot</option>
              <option value="doc_qa">doc_qa</option>
              <option value="code_assist">code_assist</option>
            </select>
          </label>

          <label className="block">
            <span className="muted text-[11px] uppercase">
              Haiku share ({haikuShare}% / {100 - haikuShare}% Sonnet)
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={haikuShare}
              onChange={(e) => setHaikuShare(Number(e.target.value))}
              className="mt-2 w-full"
            />
          </label>

          <label className="block">
            <span className="muted text-[11px] uppercase">
              Output verbosity multiplier ({verbosity.toFixed(2)}×)
            </span>
            <input
              type="range"
              min={80}
              max={150}
              value={Math.round(verbosity * 100)}
              onChange={(e) => setVerbosity(Number(e.target.value) / 100)}
              className="mt-2 w-full"
            />
          </label>

          <label className="block">
            <span className="muted text-[11px] uppercase">Monthly requests</span>
            <input
              className="input mt-1 w-full mono"
              type="number"
              value={requests}
              onChange={(e) => setRequests(Number(e.target.value))}
            />
          </label>

          <label className="block">
            <span className="muted text-[11px] uppercase">Quality assumption (required)</span>
            <textarea
              className="input mt-1 w-full"
              rows={2}
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="muted text-[11px] uppercase">Latency assumption (required)</span>
            <textarea
              className="input mt-1 w-full"
              rows={2}
              value={latency}
              onChange={(e) => setLatency(e.target.value)}
            />
          </label>
        </div>

        <div className="panel space-y-4 p-4">
          <h2 className="text-sm font-medium">Results — {feature}</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="muted text-[11px]">Baseline</div>
              <div className="kpi text-lg">
                <Money value={result.baselineCost} />
              </div>
            </div>
            <div>
              <div className="muted text-[11px]">Target</div>
              <div className="kpi text-lg">
                <Money value={result.targetCost} />
              </div>
            </div>
            <div>
              <div className="muted text-[11px]">Delta</div>
              <div
                className="kpi text-lg"
                style={{ color: result.delta < 0 ? "var(--accent)" : "var(--danger)" }}
              >
                <Money value={result.delta} />
              </div>
              <div className="muted text-[11px]">{(result.deltaPct * 100).toFixed(1)}%</div>
            </div>
          </div>

          <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="muted text-[11px] uppercase mb-1">Non-cost tradeoffs (user-entered)</div>
            <p className="text-[12.5px]">
              <strong>Quality:</strong> {quality || "—"}
            </p>
            <p className="mt-1 text-[12.5px]">
              <strong>Latency:</strong> {latency || "—"}
            </p>
          </div>

          <p className="muted text-[12px]">
            Meter does not claim quality impact. Assumptions are stored on the scenario so finance
            and eng share the same narrative.
          </p>
        </div>
      </div>
    </div>
  );
}
