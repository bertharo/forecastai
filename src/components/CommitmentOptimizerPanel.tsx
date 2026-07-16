"use client";

import { useMemo, useState } from "react";
import { Money } from "@/components/Money";
import { optimizeCommitment, adoptionBreakBudget, type FeatureDrivers, type PriceLine } from "@/lib/forecast/engine";
import { DataTable } from "@/components/DataTable";
import { pct } from "@/lib/format";

const LINES: PriceLine[] = [
  { skuId: "claude-sonnet-4", meterKey: "input_tokens", unitPrice: 2.5 / 1e6, effectiveFrom: new Date("2025-01-01"), effectiveTo: null },
  { skuId: "claude-sonnet-4", meterKey: "output_tokens", unitPrice: 12 / 1e6, effectiveFrom: new Date("2025-01-01"), effectiveTo: null },
];

export function CommitmentOptimizerPanel() {
  const [p50, setP50] = useState(28000);
  const [p90, setP90] = useState(38000);
  const [discount, setDiscount] = useState(30);

  const result = useMemo(
    () =>
      optimizeCommitment({
        p50Monthly: p50,
        p90Monthly: p90,
        commitDiscountPct: discount / 100,
      }),
    [p50, p90, discount]
  );

  const feature: FeatureDrivers = {
    featureKey: "doc_qa",
    weeklyActiveUsers: 8000,
    requestsPerActiveUser: 3.1,
    adoption: 0.4,
    routes: [
      { skuId: "claude-sonnet-4", share: 1, avgInputTokens: 3200, avgOutputTokens: 600 },
    ],
  };

  const breakBudget = adoptionBreakBudget({
    feature,
    priceLines: LINES,
    at: new Date(),
    monthlyBudget: 35000,
  });

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="panel space-y-3 p-3">
        <h2 className="text-sm font-medium">Commitment optimizer</h2>
        <p className="muted text-[12px]">
          Given P50/P90 demand, pick commit $ that minimizes expected effective cost.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <label className="block text-[11px]">
            <span className="muted">P50 monthly</span>
            <input className="input mt-1 w-full mono" type="number" value={p50} onChange={(e) => setP50(Number(e.target.value))} />
          </label>
          <label className="block text-[11px]">
            <span className="muted">P90 monthly</span>
            <input className="input mt-1 w-full mono" type="number" value={p90} onChange={(e) => setP90(Number(e.target.value))} />
          </label>
          <label className="block text-[11px]">
            <span className="muted">Discount %</span>
            <input className="input mt-1 w-full mono" type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="muted text-[11px]">Recommended commit</div>
            <div className="kpi text-base">
              <Money value={result.recommendedCommit} />
            </div>
          </div>
          <div>
            <div className="muted text-[11px]">Breakeven utilization</div>
            <div className="kpi text-base">{pct(result.breakevenUtilization, 0)}</div>
          </div>
        </div>
        <DataTable
          columns={[
            { key: "commit", label: "Commit", align: "right" },
            { key: "cost", label: "Expected cost", align: "right" },
            { key: "util", label: "Util @ P50", align: "right" },
          ]}
          rows={result.table.map((r) => ({
            commit: <Money value={r.commit} />,
            cost: <Money value={r.expectedCost} />,
            util: pct(r.utilizationAtP50, 0),
          }))}
        />
      </div>

      <div className="panel space-y-3 p-3">
        <h2 className="text-sm font-medium">Adoption impact — what breaks first</h2>
        <p className="muted text-[12px]">
          For doc_qa against a $35k monthly feature budget (CC-220 scale).
        </p>
        <div>
          <div className="muted text-[11px]">Adoption that exceeds budget</div>
          <div className="kpi text-base">
            {breakBudget.breakAdoption == null
              ? "Does not breach ≤100%"
              : pct(breakBudget.breakAdoption, 1)}
          </div>
          <div className="muted mt-1 text-[11px]">
            Cost at break: <Money value={breakBudget.costAtBreak} />
          </div>
        </div>
        <p className="muted text-[12px]">
          Commitment becomes cheaper than on-demand when utilization stays above the breakeven
          shown in the optimizer (≈ {pct(result.breakevenUtilization, 0)} at {discount}% discount).
        </p>
      </div>
    </div>
  );
}
