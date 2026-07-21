import Link from "next/link";
import { pct, usd } from "@/lib/format";
import type { BriefFacts } from "@/lib/queries/brief";
import { EmptyState } from "@/components/EmptyState";

export function FinopsOnePager({ facts }: { facts: BriefFacts }) {
  if (facts.empty) {
    return (
      <EmptyState
        message="No spend yet. Connect a source or import a CSV to see vendor and cost-center rollup."
        action={{ href: "/connectors", label: "Open Sources" }}
      />
    );
  }

  const { attribution, byVendor, byDepartment, byCostCenter, findings, period } = facts;
  const deptTotal =
    byDepartment.reduce((a, r) => a + r.spend, 0) || attribution.totalSpend || 1;
  const ccTotal =
    byCostCenter.reduce((a, r) => a + r.spend, 0) || attribution.totalSpend || 1;
  const hasRosterCc = byCostCenter.some(
    (r) => r.source === "roster" && (r.costCenter || r.costCenterPath)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
          Period · {period.label}
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

        <div className="panel p-4">
          <div className="text-[13px] font-semibold">By cost center</div>
          <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
            {hasRosterCc
              ? "People CSV cost-center chain (deepest level) · path shows L02–L07"
              : "Via roster email or key → team map"}
          </p>
          <div className="mt-3 space-y-2">
            {byCostCenter.slice(0, 8).map((d) => (
              <div
                key={`${d.label}-${d.source}-${d.costCenterPath ?? ""}`}
                className="flex items-center justify-between gap-2 text-[13px]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{d.label}</span>
                  {d.costCenterPath && d.costCenterPath !== d.label ? (
                    <span
                      className="block truncate text-[11px]"
                      style={{ color: "var(--muted)" }}
                      title={d.costCenterPath}
                    >
                      {d.costCenterPath}
                    </span>
                  ) : d.department && d.department !== d.label ? (
                    <span
                      className="block truncate text-[11px]"
                      style={{ color: "var(--muted)" }}
                    >
                      {d.department}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-semibold">
                  {usd(d.spend)}{" "}
                  <span className="font-normal" style={{ color: "var(--muted)" }}>
                    {pct(d.spend / ccTotal, 0)}
                  </span>
                </span>
              </div>
            ))}
            {byCostCenter.length === 0 && (
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                Import people with Cost Center Chain levels to roll spend up by cost center
              </p>
            )}
          </div>
        </div>
      </div>

      {byDepartment.some((d) => d.source === "roster") ? (
        <div className="panel p-4">
          <div className="text-[13px] font-semibold">By department</div>
          <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
            Mid chain level (usually L04) from the people roster
          </p>
          <div className="mt-3 space-y-2">
            {byDepartment.slice(0, 8).map((d) => (
              <div
                key={`${d.department}-${d.source}-${d.costCenter ?? ""}-${d.costCenterPath ?? ""}`}
                className="flex items-center justify-between gap-2 text-[13px]"
              >
                <span className="min-w-0 truncate">
                  {d.department}
                  {d.costCenter ? (
                    <span style={{ color: "var(--muted)" }}> · {d.costCenter}</span>
                  ) : null}
                </span>
                <span className="shrink-0 font-semibold">
                  {usd(d.spend)}{" "}
                  <span className="font-normal" style={{ color: "var(--muted)" }}>
                    {pct(d.spend / deptTotal, 0)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
