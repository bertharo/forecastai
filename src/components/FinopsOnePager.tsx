import Link from "next/link";
import { pct, usd } from "@/lib/format";
import type { BriefFacts, BriefDimensionRollup } from "@/lib/queries/brief";
import { EmptyState } from "@/components/EmptyState";

const VISIBLE_ROWS = 8;

function DimensionCard({
  dim,
  totalSpend,
}: {
  dim: BriefDimensionRollup;
  totalSpend: number;
}) {
  const denom = dim.rows.reduce((a, r) => a + r.spend, 0) || totalSpend || 1;
  const visible = dim.rows.slice(0, VISIBLE_ROWS);
  const hidden = dim.rows.slice(VISIBLE_ROWS);
  const hiddenSpend = hidden.reduce((a, r) => a + r.spend, 0);
  const hiddenShare = denom > 0 ? hiddenSpend / denom : 0;

  return (
    <div className="panel p-4">
      <div className="text-[13px] font-semibold">{dim.displayName}</div>
      <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
        {dim.sourceColumn}
        {dim.role === "primary" ? " · primary" : dim.role === "secondary" ? " · secondary" : ""}
      </p>
      <div className="mt-3 space-y-2">
        {visible.map((d) => (
          <div
            key={`${d.label}-${d.source}`}
            className="flex items-center justify-between gap-2 text-[13px]"
          >
            <span className="min-w-0 truncate font-medium">{d.label}</span>
            <span className="shrink-0 font-semibold">
              {usd(d.spend)}{" "}
              <span className="font-normal" style={{ color: "var(--muted)" }}>
                {pct(d.spend / denom, 0)}
              </span>
            </span>
          </div>
        ))}
        {hidden.length > 0 && (
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>
            +{hidden.length} more · {usd(hiddenSpend)} ({pct(hiddenShare, 0)} of spend)
          </p>
        )}
        {dim.rows.length === 0 && (
          <p className="text-[12px]" style={{ color: "var(--muted)" }}>
            No spend for this dimension in the period
          </p>
        )}
      </div>
    </div>
  );
}

export function FinopsOnePager({ facts }: { facts: BriefFacts }) {
  if (facts.empty) {
    return (
      <EmptyState
        message="No spend yet. Connect a source or import a CSV to see vendor and org rollups."
        action={{ href: "/connectors", label: "Open Sources" }}
      />
    );
  }

  if (facts.periodEmpty) {
    return (
      <EmptyState
        message={`No spend in ${facts.period.label}. All-time total is ${usd(facts.allTimeSpend)} — pick a period that matches your data grain.`}
        action={{ href: "/connectors", label: "Open Sources" }}
      />
    );
  }

  const { attribution, byVendor, byDimensions, findings, period, needsDimensionConfig } =
    facts;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
          Period · {period.label}
          {period.grain === "monthly" ? " (calendar months)" : ""}
          {facts.allTimeSpend > 0.01 &&
          Math.abs(facts.allTimeSpend - facts.totalSpend) > 0.02 ? (
            <span title="Sum of every cost row (matches full spreadsheet import)">
              {" "}
              · All-time {usd(facts.allTimeSpend)}
            </span>
          ) : null}
        </p>
        {facts.violations.length > 0 && (
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ background: "rgba(196,59,59,0.12)", color: "var(--danger)" }}
            title={facts.violations.map((v) => v.message).join("; ")}
          >
            Numbers don&apos;t reconcile · {facts.violations.length}
          </span>
        )}
        {facts.dataMixed && (
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ background: "rgba(196,90,42,0.12)", color: "var(--warning)" }}
            title="Sample data and CSV imports are mixed. Reset from Settings to clean up."
          >
            Sample + imports mixed
          </span>
        )}
      </div>

      <div className="panel p-4">
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          Attribution
        </div>
        <Link
          href="/keys?unmapped=1"
          className="mt-2 block text-[28px] font-bold tracking-tight hover:underline"
        >
          {pct(attribution.attributedPct, 0)} of spend attributed
        </Link>
        <p
          className="mt-2 max-w-2xl text-[13px] leading-relaxed"
          style={{ color: "var(--muted)" }}
          title={`Email join ${usd(attribution.emailJoinSpend)} · key registry ${usd(attribution.keyRegistrySpend)} · unallocated ${usd(attribution.unallocatedSpend)}`}
        >
          {usd(attribution.attributedSpend)} of {usd(attribution.totalSpend)} mapped to teams
          {" "}
          ({period.label})
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-4">
          <div className="text-[13px] font-semibold">By vendor</div>
          <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
            Spreadsheet tool labels when present (Claude, Cursor, Copilot, Gemini…)
          </p>
          <div className="mt-3 space-y-2">
            {byVendor.slice(0, 8).map((v) => (
              <div key={v.key} className="flex items-center justify-between text-[13px]">
                <span>{v.name}</span>
                <span className="font-semibold">{usd(v.spend)}</span>
              </div>
            ))}
            {byVendor.length === 0 && (
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                No vendor spend yet
              </p>
            )}
          </div>
        </div>

        {needsDimensionConfig ? (
          <div className="panel flex flex-col justify-center p-4">
            <div className="text-[13px] font-semibold">Configure your org dimensions</div>
            <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
              Choose which people-CSV attributes to roll spend by on Home.
            </p>
            <Link href="/connectors#org-dimensions" className="btn mt-4 inline-flex w-fit">
              Open Sources
            </Link>
          </div>
        ) : byDimensions[0] ? (
          <DimensionCard dim={byDimensions[0]} totalSpend={attribution.totalSpend} />
        ) : (
          <div className="panel p-4">
            <div className="text-[13px] font-semibold">Org dimensions</div>
            <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
              Import a people CSV, then enable dimensions on Sources.
            </p>
            <Link href="/connectors#org-dimensions" className="mt-3 inline-block text-[13px] underline">
              Open Sources
            </Link>
          </div>
        )}
      </div>

      {byDimensions.slice(1).map((dim) => (
        <DimensionCard key={dim.key} dim={dim} totalSpend={attribution.totalSpend} />
      ))}

      {facts.sampleDataLoadedAt ? (
        <p className="text-[12px]" style={{ color: "var(--muted)" }}>
          Sample pack active — clear or reset from Settings before importing CSVs.
        </p>
      ) : null}

      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-semibold">Findings</div>
          <Link href="/import#roster" className="text-[12px]" style={{ color: "var(--muted)" }}>
            Fix data →
          </Link>
        </div>
        {findings.length === 0 ? (
          <p className="mt-3 text-[13px]" style={{ color: "var(--muted)" }}>
            No terminated seats, inactive seats, or unmapped keys flagged.
          </p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {findings.map((f) => (
              <Link
                key={f.id}
                href={f.href}
                className="row-card block transition-shadow hover:shadow-sm"
                style={{
                  borderColor:
                    f.severity === "high" ? "rgba(196,59,59,0.35)" : "var(--border)",
                }}
              >
                <div className="text-[12px] font-semibold">{f.title}</div>
                <div className="kpi mt-1" style={{ fontSize: "1.35rem" }}>
                  {f.count}
                </div>
                <p className="mt-1 text-[12px] leading-snug" style={{ color: "var(--muted)" }}>
                  {f.detail}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
