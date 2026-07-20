"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Money } from "@/components/Money";
import {
  modelSwitchDelta,
  optimizeCommitment,
  type PriceLine,
  type RouteSplit,
} from "@/lib/forecast/engine";
import { pct, usd } from "@/lib/format";

const PRICE_LINES: PriceLine[] = [
  {
    skuId: "claude-sonnet-4",
    meterKey: "input_tokens",
    unitPrice: 2.5 / 1e6,
    effectiveFrom: new Date("2025-01-01"),
    effectiveTo: null,
  },
  {
    skuId: "claude-sonnet-4",
    meterKey: "output_tokens",
    unitPrice: 12 / 1e6,
    effectiveFrom: new Date("2025-01-01"),
    effectiveTo: null,
  },
  {
    skuId: "claude-haiku-3.5",
    meterKey: "input_tokens",
    unitPrice: 0.8 / 1e6,
    effectiveFrom: new Date("2025-01-01"),
    effectiveTo: null,
  },
  {
    skuId: "claude-haiku-3.5",
    meterKey: "output_tokens",
    unitPrice: 4 / 1e6,
    effectiveFrom: new Date("2025-01-01"),
    effectiveTo: null,
  },
  {
    skuId: "gpt-4o",
    meterKey: "input_tokens",
    unitPrice: 2.5 / 1e6,
    effectiveFrom: new Date("2025-01-01"),
    effectiveTo: null,
  },
  {
    skuId: "gpt-4o",
    meterKey: "output_tokens",
    unitPrice: 10 / 1e6,
    effectiveFrom: new Date("2025-01-01"),
    effectiveTo: null,
  },
];

const MODELS = [
  {
    id: "claude-haiku-3.5",
    label: "Haiku",
    blurb: "Fast & cheap — good for drafts, triage, simple Q&A",
  },
  {
    id: "claude-sonnet-4",
    label: "Sonnet",
    blurb: "Balanced — solid for most product and coding work",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    blurb: "Strong general model — similar price band to Sonnet",
  },
] as const;

type TeamKey = "support" | "marketing" | "engineering" | "product";

const TEAMS: {
  key: TeamKey;
  label: string;
  role: string;
  monthlyRequests: number;
  currentModel: string;
  tokensIn: number;
  tokensOut: number;
}[] = [
  {
    key: "support",
    label: "Support",
    role: "Ticket triage & replies",
    monthlyRequests: 126_000,
    currentModel: "claude-sonnet-4",
    tokensIn: 1800,
    tokensOut: 420,
  },
  {
    key: "marketing",
    label: "Marketing",
    role: "Campaign copy & research",
    monthlyRequests: 48_000,
    currentModel: "claude-sonnet-4",
    tokensIn: 2200,
    tokensOut: 800,
  },
  {
    key: "engineering",
    label: "Engineering",
    role: "Code assist & reviews",
    monthlyRequests: 90_000,
    currentModel: "claude-sonnet-4",
    tokensIn: 3200,
    tokensOut: 900,
  },
  {
    key: "product",
    label: "Product",
    role: "Docs Q&A & specs",
    monthlyRequests: 36_000,
    currentModel: "claude-sonnet-4",
    tokensIn: 2800,
    tokensOut: 600,
  },
];

const ROLE_RECOS: {
  team: TeamKey;
  recommendModel: string;
  mix?: { cheap: number }; // % on cheaper model
  why: string;
  watchOut: string;
}[] = [
  {
    team: "marketing",
    recommendModel: "claude-haiku-3.5",
    why: "Most marketing drafts don’t need the expensive model. Haiku is usually enough for first passes and outlines.",
    watchOut: "Keep Sonnet for final legal/compliance copy or brand-sensitive launches.",
  },
  {
    team: "support",
    recommendModel: "claude-haiku-3.5",
    mix: { cheap: 80 },
    why: "Route everyday tickets to Haiku; keep Sonnet for messy or high-stakes conversations.",
    watchOut: "Measure CSAT after the change — escalate when the cheap model stalls.",
  },
  {
    team: "engineering",
    recommendModel: "claude-sonnet-4",
    why: "Code quality and fewer wrong answers usually beat the cheaper sticker price.",
    watchOut: "Use Haiku only for boilerplate or autocomplete-style tasks.",
  },
  {
    team: "product",
    recommendModel: "claude-haiku-3.5",
    mix: { cheap: 70 },
    why: "Internal docs Q&A is a good fit for a cheaper model with Sonnet as a fallback.",
    watchOut: "Complex roadmap / strategy writing may still want Sonnet.",
  },
];

type Tab = "model" | "cap" | "role" | "discount";

function routeFor(
  skuId: string,
  share: number,
  tokensIn: number,
  tokensOut: number,
  verbosity = 1
): RouteSplit {
  return {
    skuId,
    share,
    avgInputTokens: tokensIn,
    avgOutputTokens: tokensOut,
    verbosityMultiplier: verbosity,
  };
}

function modelLabel(id: string) {
  return MODELS.find((m) => m.id === id)?.label ?? id;
}

export function WhatIfScenarios() {
  const [tab, setTab] = useState<Tab>("model");

  // Model switch
  const [teamKey, setTeamKey] = useState<TeamKey>("support");
  const [toModel, setToModel] = useState("claude-haiku-3.5");
  const [cheapShare, setCheapShare] = useState(80);

  // Cap
  const [capTeam, setCapTeam] = useState<TeamKey>("marketing");
  const [capUsd, setCapUsd] = useState(2500);

  // Discount (simplified commitment)
  const [typicalSpend, setTypicalSpend] = useState(28000);
  const [busyMonth, setBusyMonth] = useState(38000);
  const [discountPct, setDiscountPct] = useState(30);

  const team = TEAMS.find((t) => t.key === teamKey)!;
  const capTeamRow = TEAMS.find((t) => t.key === capTeam)!;

  const switchResult = useMemo(() => {
    const baseline: RouteSplit[] = [
      routeFor(team.currentModel, 1, team.tokensIn, team.tokensOut),
    ];
    const allCheap = toModel !== team.currentModel;
    const target: RouteSplit[] = allCheap
      ? [
          routeFor(
            toModel,
            cheapShare / 100,
            team.tokensIn,
            team.tokensOut,
            toModel.includes("haiku") ? 1.05 : 1
          ),
          routeFor(
            team.currentModel,
            1 - cheapShare / 100,
            team.tokensIn,
            team.tokensOut
          ),
        ]
      : [routeFor(team.currentModel, 1, team.tokensIn, team.tokensOut)];
    return modelSwitchDelta({
      requests: team.monthlyRequests,
      baselineRoutes: baseline,
      targetRoutes: target,
      priceLines: PRICE_LINES,
      at: new Date(),
    });
  }, [team, toModel, cheapShare]);

  const capBaseline = useMemo(() => {
    const baseline: RouteSplit[] = [
      routeFor(
        capTeamRow.currentModel,
        1,
        capTeamRow.tokensIn,
        capTeamRow.tokensOut
      ),
    ];
    return modelSwitchDelta({
      requests: capTeamRow.monthlyRequests,
      baselineRoutes: baseline,
      targetRoutes: baseline,
      priceLines: PRICE_LINES,
      at: new Date(),
    }).baselineCost;
  }, [capTeamRow]);

  const roleCards = useMemo(() => {
    return ROLE_RECOS.map((reco) => {
      const t = TEAMS.find((x) => x.key === reco.team)!;
      const baseline: RouteSplit[] = [
        routeFor(t.currentModel, 1, t.tokensIn, t.tokensOut),
      ];
      const cheap = reco.mix?.cheap ?? 100;
      const target: RouteSplit[] =
        reco.recommendModel === t.currentModel
          ? baseline
          : [
              routeFor(
                reco.recommendModel,
                cheap / 100,
                t.tokensIn,
                t.tokensOut,
                reco.recommendModel.includes("haiku") ? 1.05 : 1
              ),
              routeFor(t.currentModel, 1 - cheap / 100, t.tokensIn, t.tokensOut),
            ];
      const delta = modelSwitchDelta({
        requests: t.monthlyRequests,
        baselineRoutes: baseline,
        targetRoutes: target,
        priceLines: PRICE_LINES,
        at: new Date(),
      });
      return { reco, team: t, delta };
    });
  }, []);

  const commit = useMemo(
    () =>
      optimizeCommitment({
        p50Monthly: typicalSpend,
        p90Monthly: busyMonth,
        commitDiscountPct: discountPct / 100,
      }),
    [typicalSpend, busyMonth, discountPct]
  );

  const tabs: { id: Tab; label: string; hint: string }[] = [
    { id: "model", label: "Switch models", hint: "What if this team used a different model?" },
    { id: "cap", label: "Cap spend", hint: "What if we set a monthly limit?" },
    { id: "role", label: "By role", hint: "Suggested models for each kind of work" },
    { id: "discount", label: "Volume discount", hint: "What if we prepay for a lower rate?" },
  ];

  const savings = -switchResult.delta;
  const overCap = Math.max(0, capBaseline - capUsd);
  const underCap = Math.max(0, capUsd - capBaseline);
  const daysToCap =
    capBaseline > 0 ? Math.min(30, Math.floor((capUsd / capBaseline) * 30)) : 30;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="pill-tab"
            data-active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "model" && (
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <div className="soft-card space-y-4">
            <div>
              <div className="text-[13px] font-semibold">What if this team used a different model?</div>
              <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
                Same amount of work — only the model mix changes.
              </p>
            </div>

            <label className="block">
              <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                Team
              </span>
              <select
                className="select mt-1 w-full"
                value={teamKey}
                onChange={(e) => setTeamKey(e.target.value as TeamKey)}
              >
                {TEAMS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label} — {t.role}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                Switch most traffic to
              </span>
              <div className="mt-2 grid gap-2">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setToModel(m.id)}
                    className="row-card text-left transition-shadow hover:shadow-sm"
                    style={{
                      borderColor:
                        toModel === m.id ? "#2f5bd8" : "var(--border)",
                      background:
                        toModel === m.id ? "rgba(47,91,216,0.06)" : undefined,
                    }}
                  >
                    <div className="text-[14px] font-semibold">{m.label}</div>
                    <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                      {m.blurb}
                    </div>
                  </button>
                ))}
              </div>
            </label>

            {toModel !== team.currentModel && (
              <label className="block">
                <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                  How much goes to {modelLabel(toModel)}? ({cheapShare}% ·{" "}
                  {100 - cheapShare}% stays on {modelLabel(team.currentModel)})
                </span>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={cheapShare}
                  onChange={(e) => setCheapShare(Number(e.target.value))}
                  className="mt-2 w-full"
                />
              </label>
            )}
          </div>

          <div className="soft-card space-y-4">
            <div className="text-[13px] font-semibold">
              {team.label} · monthly estimate
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                  Today
                </div>
                <div className="kpi text-xl">
                  <Money value={switchResult.baselineCost} digits={0} />
                </div>
              </div>
              <div>
                <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                  After switch
                </div>
                <div className="kpi text-xl">
                  <Money value={switchResult.targetCost} digits={0} />
                </div>
              </div>
              <div>
                <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                  {savings >= 0 ? "You save" : "It costs more"}
                </div>
                <div
                  className="kpi text-xl"
                  style={{
                    color: savings >= 0 ? "var(--success)" : "var(--danger)",
                  }}
                >
                  <Money value={Math.abs(savings)} digits={0} />
                </div>
                <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                  {pct(Math.abs(switchResult.deltaPct), 0)}
                </div>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: "#3a4050" }}>
              {team.label} keeps doing ~{team.monthlyRequests.toLocaleString()}{" "}
              requests/month.{" "}
              {toModel === team.currentModel
                ? "No change — same model as today."
                : `${cheapShare}% moves to ${modelLabel(toModel)}; the rest stays on ${modelLabel(team.currentModel)}.`}
            </p>
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>
              Meter shows cost only — you still decide if quality is good enough for this
              team.{" "}
              <Link href="/model-switch" className="underline">
                Fine-tune assumptions →
              </Link>
            </p>
          </div>
        </div>
      )}

      {tab === "cap" && (
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <div className="soft-card space-y-4">
            <div>
              <div className="text-[13px] font-semibold">What if we cap this team’s spend?</div>
              <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
                Set a monthly dollar limit and see whether today’s pace would break it.
              </p>
            </div>
            <label className="block">
              <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                Team
              </span>
              <select
                className="select mt-1 w-full"
                value={capTeam}
                onChange={(e) => setCapTeam(e.target.value as TeamKey)}
              >
                {TEAMS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                Monthly cap ({usd(capUsd)})
              </span>
              <input
                type="range"
                min={500}
                max={Math.max(8000, Math.ceil(capBaseline * 1.5))}
                step={100}
                value={capUsd}
                onChange={(e) => setCapUsd(Number(e.target.value))}
                className="mt-2 w-full"
              />
              <input
                className="input mt-2 w-40 mono"
                type="number"
                value={capUsd}
                onChange={(e) => setCapUsd(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="soft-card space-y-3">
            <div className="text-[13px] font-semibold">{capTeamRow.label} vs {usd(capUsd)} cap</div>
            <div className="kpi text-2xl">
              {overCap > 0 ? "Would go over" : "Stays under the cap"}
            </div>
            <p className="text-[14px] leading-relaxed" style={{ color: "#3a4050" }}>
              Current pace ≈ <strong>{usd(capBaseline)}</strong>/month.
              {overCap > 0 ? (
                <>
                  {" "}
                  At this rate they hit the cap around day <strong>{daysToCap}</strong> and
                  finish ~<strong>{usd(overCap)}</strong> over — unless you throttle or
                  switch models.
                </>
              ) : (
                <>
                  {" "}
                  About <strong>{usd(underCap)}</strong> of headroom left this month.
                </>
              )}
            </p>
            {overCap > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setTeamKey(capTeam);
                  setToModel("claude-haiku-3.5");
                  setTab("model");
                }}
              >
                Try a cheaper model for {capTeamRow.label} →
              </button>
            )}
          </div>
        </div>
      )}

      {tab === "role" && (
        <div className="space-y-3">
          <div className="soft-card">
            <div className="text-[13px] font-semibold">Suggested models by role</div>
            <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
              Starting points based on the kind of work — not hard rules. Numbers assume
              today’s volume on each team.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {roleCards.map(({ reco, team: t, delta }) => {
              const save = -delta.delta;
              return (
                <div key={reco.team} className="soft-card space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[15px] font-semibold">{t.label}</div>
                      <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                        {t.role}
                      </div>
                    </div>
                    <div
                      className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
                      style={{ background: "rgba(47,91,216,0.1)", color: "#2f5bd8" }}
                    >
                      Use {modelLabel(reco.recommendModel)}
                      {reco.mix ? ` ~${reco.mix.cheap}%` : ""}
                    </div>
                  </div>
                  <p className="text-[13px] leading-relaxed">{reco.why}</p>
                  <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                    Watch out: {reco.watchOut}
                  </p>
                  <div className="flex flex-wrap items-end justify-between gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                    <div>
                      <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                        Est. monthly change
                      </div>
                      <div
                        className="text-[18px] font-bold"
                        style={{
                          color: save >= 0 ? "var(--success)" : "var(--danger)",
                        }}
                      >
                        {save >= 0 ? "−" : "+"}
                        {usd(Math.abs(save))}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost text-[13px]"
                      onClick={() => {
                        setTeamKey(t.key);
                        setToModel(reco.recommendModel);
                        if (reco.mix) setCheapShare(reco.mix.cheap);
                        setTab("model");
                      }}
                    >
                      Try this →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "discount" && (
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <div className="soft-card space-y-4">
            <div>
              <div className="text-[13px] font-semibold">
                What if we prepaid for a lower rate?
              </div>
              <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
                Some vendors discount if you commit to a monthly amount. Enter a typical
                month and a busy month — we’ll suggest a commit that usually saves money.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-[12px]">
                <span style={{ color: "var(--muted)" }}>Typical month ($)</span>
                <input
                  className="input mt-1 w-full mono"
                  type="number"
                  value={typicalSpend}
                  onChange={(e) => setTypicalSpend(Number(e.target.value))}
                />
              </label>
              <label className="block text-[12px]">
                <span style={{ color: "var(--muted)" }}>Busy month ($)</span>
                <input
                  className="input mt-1 w-full mono"
                  type="number"
                  value={busyMonth}
                  onChange={(e) => setBusyMonth(Number(e.target.value))}
                />
              </label>
              <label className="block text-[12px]">
                <span style={{ color: "var(--muted)" }}>Discount %</span>
                <input
                  className="input mt-1 w-full mono"
                  type="number"
                  value={discountPct}
                  onChange={(e) => setDiscountPct(Number(e.target.value))}
                />
              </label>
            </div>
          </div>
          <div className="soft-card space-y-3">
            <div className="text-[13px] font-semibold">Suggestion</div>
            <div className="kpi text-2xl">
              <Money value={commit.recommendedCommit} digits={0} />
              <span className="ml-2 text-[14px] font-medium" style={{ color: "var(--muted)" }}>
                / month commit
              </span>
            </div>
            <p className="text-[14px] leading-relaxed" style={{ color: "#3a4050" }}>
              At a {discountPct}% discount, this usually beats paying full price — as long
              as you use at least about{" "}
              <strong>{pct(commit.breakevenUtilization, 0)}</strong> of what you commit.
              Expected bill ≈{" "}
              <strong>
                <Money value={commit.expectedCost} digits={0} />
              </strong>
              .
            </p>
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>
              If usage dips a lot below the commit, you can waste prepaid dollars — start
              near a typical month, not a peak.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
