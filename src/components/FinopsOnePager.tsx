import Link from "next/link";
import { pct, usd } from "@/lib/format";
import { LoadSampleButton } from "@/components/LoadSampleButton";
import type { getFinopsDashboard } from "@/lib/queries/finops";

type Dash = Awaited<ReturnType<typeof getFinopsDashboard>>;

export function FinopsOnePager({ dash }: { dash: Dash }) {
  if (dash.empty) {
    return (
      <div className="soft-card space-y-4" style={{ background: "var(--card-blue)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          FinOps
        </div>
        <p className="text-[18px] font-semibold leading-snug">
          See vendor spend, department rollup, and waste findings in one page.
        </p>
        <p className="text-[14px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Upload an HRIS roster + vendor CSV under Import, or load a deterministic sample
          pack (~2,000 people, terminated seats, unmapped keys) with no connectors.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <LoadSampleButton />
          <Link href="/import" className="btn btn-ghost">
            Import CSV →
          </Link>
        </div>
      </div>
    );
  }

  const { coverage, byVendor, byDepartment, findings } = dash;
  const deptTotal =
    byDepartment.reduce((a, r) => a + r.spend, 0) || coverage.totalSpend || 1;

  return (
    <div className="space-y-4">
      <div className="soft-card" style={{ background: "var(--card-blue)" }}>
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
          {pct(coverage.allocatedPct, 0)} of spend attributed
        </Link>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed" style={{ color: "#3a4050" }}>
          Spend-weighted · {usd(coverage.allocatedSpend)} of {usd(coverage.totalSpend)}{" "}
          trailing 30d · email join {usd(coverage.joinedEmailSpend)} · key registry{" "}
          {usd(coverage.keyRegistrySpend)} · unallocated {usd(coverage.unallocatedSpend)}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="soft-card">
          <div className="text-[13px] font-semibold">By vendor</div>
          <div className="mt-3 space-y-2">
            {byVendor.slice(0, 6).map((v) => (
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

        <div className="soft-card">
          <div className="text-[13px] font-semibold">By department</div>
          <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
            Via email → roster (or key-registry team fallback)
          </p>
          <div className="mt-3 space-y-2">
            {byDepartment.slice(0, 8).map((d) => (
              <div
                key={`${d.department}-${d.source}-${d.costCenter ?? ""}`}
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
            {byDepartment.length === 0 && (
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                Import a roster to roll spend up by department
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="soft-card">
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
