import { DataTable } from "@/components/DataTable";
import { Money } from "@/components/Money";
import { getCurrentOrg } from "@/lib/queries/org";
import { db } from "@/db";
import * as s from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { pct, usd } from "@/lib/format";
import {
  hierarchyWarnings,
  refreshBudgetSnapshots,
} from "@/lib/budgets/status";
import { BudgetActions } from "./BudgetActions";

export const dynamic = "force-dynamic";

function BurnSpark({
  points,
}: {
  points: { actual: number; proRata: number; p50: number }[];
}) {
  if (points.length < 2) return null;
  const w = 160;
  const h = 36;
  const max = Math.max(...points.flatMap((p) => [p.actual, p.proRata, p.p50]), 1);
  const line = (key: "actual" | "proRata" | "p50", stroke: string) => {
    const pts = points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * w;
        const y = h - (p[key] / max) * (h - 4) - 2;
        return `${x},${y}`;
      })
      .join(" ");
    return (
      <polyline fill="none" stroke={stroke} strokeWidth="1.2" points={pts} />
    );
  };
  return (
    <svg width={w} height={h} className="block">
      {line("proRata", "var(--muted)")}
      {line("p50", "var(--warning)")}
      {line("actual", "var(--accent)")}
    </svg>
  );
}

export default async function BudgetsPage() {
  const org = await getCurrentOrg();
  if (!org) return <p className="muted">No org — run npm run db:seed</p>;

  const statuses = await refreshBudgetSnapshots(org.id);
  const [alerts, nodes, types, versions, warnings, notifications] =
    await Promise.all([
      db
        .select()
        .from(s.budgetAlerts)
        .orderBy(desc(s.budgetAlerts.firedAt))
        .limit(20),
      db.select().from(s.dimensionNodes).where(eq(s.dimensionNodes.orgId, org.id)),
      db.select().from(s.dimensionTypes).where(eq(s.dimensionTypes.orgId, org.id)),
      db
        .select({
          ver: s.budgetVersions,
          budgetName: s.budgets.name,
        })
        .from(s.budgetVersions)
        .innerJoin(s.budgets, eq(s.budgetVersions.budgetId, s.budgets.id))
        .where(eq(s.budgets.orgId, org.id))
        .orderBy(desc(s.budgetVersions.createdAt))
        .limit(30),
      hierarchyWarnings(org.id),
      db
        .select()
        .from(s.notifications)
        .where(eq(s.notifications.orgId, org.id))
        .orderBy(desc(s.notifications.createdAt))
        .limit(8),
    ]);

  const budgets = await db
    .select()
    .from(s.budgets)
    .where(eq(s.budgets.orgId, org.id));

  const statusById = new Map(statuses.map((st) => [st.budgetId, st]));
  const nodeName = (id: string | null) =>
    id ? nodes.find((n) => n.id === id)?.displayName ?? id : "—";
  const typeName = (id: string | null) =>
    id ? types.find((t) => t.id === id)?.displayName ?? id : "—";

  const sorted = [...budgets].sort((a, b) => {
    const sa = statusById.get(a.id);
    const sb = statusById.get(b.id);
    const rank = {
      exceeded: 0,
      "projected-breach": 1,
      warn: 2,
      ok: 3,
    } as const;
    return (rank[sa?.status ?? "ok"] ?? 9) - (rank[sb?.status ?? "ok"] ?? 9);
  });

  return (
    <div className="space-y-5">
      <div className="soft-card" style={{ background: "var(--card-pink)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          Plan
        </div>
        <p className="mt-2 max-w-2xl text-[16px] font-medium leading-snug">
          Versioned budgets with burn-down, projected breach, and gateway status — the plan of
          record FinOps signs off on.
        </p>
      </div>

      {warnings.length > 0 && (
        <div
          className="panel p-3 text-[12px]"
          style={{ borderColor: "var(--warning)", color: "var(--warning)" }}
        >
          Hierarchy warning:{" "}
          {warnings
            .map(
              (w) =>
                `${w.childName} (${usd(w.childAmount)}) exceeds parent ${w.parentName} (${usd(w.parentAmount)})`
            )
            .join(" · ")}
        </div>
      )}

      <div className="panel overflow-x-auto p-3">
        <h2 className="mb-2 text-sm font-medium">Budget control plane</h2>
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr style={{ color: "var(--muted)" }}>
              <th className="pb-2 pr-2">Scope</th>
              <th className="pb-2 pr-2">Period</th>
              <th className="pb-2 pr-2 text-right">Amount</th>
              <th className="pb-2 pr-2 text-right">Spent</th>
              <th className="pb-2 pr-2 text-right">P50 EOP</th>
              <th className="pb-2 pr-2">Breach</th>
              <th className="pb-2 pr-2">Status</th>
              <th className="pb-2">Burn-down</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((b) => {
              const st = statusById.get(b.id);
              const scope =
                b.scopeType === "org"
                  ? "Org"
                  : `${typeName(b.dimensionTypeId)} → ${nodeName(b.dimensionNodeId)}`;
              const color =
                st?.status === "exceeded"
                  ? "var(--danger)"
                  : st?.status === "projected-breach" || st?.status === "warn"
                    ? "var(--warning)"
                    : "var(--accent)";
              return (
                <tr key={b.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="py-2 pr-2">
                    <div className="font-medium">{b.name}</div>
                    <div className="muted">{scope}</div>
                  </td>
                  <td className="py-2 pr-2">{b.period}</td>
                  <td className="mono py-2 pr-2 text-right">
                    <Money value={Number(b.amount)} />
                  </td>
                  <td className="mono py-2 pr-2 text-right">
                    {st ? usd(st.spent) : "—"}
                    {st && (
                      <div className="muted">{pct(st.usedPct, 0)}</div>
                    )}
                  </td>
                  <td className="mono py-2 pr-2 text-right">
                    {st ? usd(st.projectedP50) : "—"}
                  </td>
                  <td className="mono py-2 pr-2">{st?.breachDate ?? "—"}</td>
                  <td className="py-2 pr-2" style={{ color }}>
                    {st?.status ?? "—"}
                    {st?.policyAction && (
                      <div className="muted text-[10px]">{st.policyAction}</div>
                    )}
                  </td>
                  <td className="py-2">
                    {st && <BurnSpark points={st.burnDown} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted mt-2 text-[11px]">
          Burn-down: accent = actual, muted = pro-rata, warning = P50 projection.{" "}
          <span className="mono">GET /api/budgets/status</span> for gateway hooks.
        </p>
      </div>

      <BudgetActions
        budgets={budgets.map((b) => ({
          id: b.id,
          name: b.name,
          amount: Number(b.amount),
        }))}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">Version history</h2>
          <DataTable
            columns={[
              { key: "budget", label: "Budget" },
              { key: "v", label: "Ver" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "note", label: "Note" },
              { key: "when", label: "Effective" },
            ]}
            rows={versions.map(({ ver, budgetName }) => ({
              budget: budgetName,
              v: ver.version,
              amount: usd(Number(ver.amount)),
              note: ver.changeNote,
              when: ver.effectiveFrom.toISOString().slice(0, 10),
            }))}
          />
        </div>
        <div className="panel p-3">
          <h2 className="mb-2 text-sm font-medium">Alerts & notifications</h2>
          <DataTable
            columns={[
              { key: "fired", label: "Fired" },
              { key: "threshold", label: "Thresh" },
              { key: "action", label: "Policy" },
              { key: "message", label: "Message" },
            ]}
            rows={alerts.map((a) => ({
              fired: a.firedAt.toISOString().slice(0, 16).replace("T", " "),
              threshold: pct(Number(a.thresholdPct), 0),
              action: a.policyAction ?? "—",
              message: a.message,
            }))}
          />
          {notifications.length > 0 && (
            <ul className="mt-3 space-y-1 text-[11px]">
              {notifications.map((n) => (
                <li key={n.id} className="muted">
                  {n.title}: {n.body}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
