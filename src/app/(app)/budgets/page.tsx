import { DataTable } from "@/components/DataTable";
import { Money } from "@/components/Money";
import { getDemoOrg } from "@/lib/queries/org";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { pct } from "@/lib/format";
import { getSpendSummary } from "@/lib/queries/spend";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const org = await getDemoOrg();
  if (!org) return <p className="muted">No org — run npm run db:seed</p>;

  const [budgets, alerts, summary, nodes, types] = await Promise.all([
    db.select().from(s.budgets).where(eq(s.budgets.orgId, org.id)),
    db.select().from(s.budgetAlerts),
    getSpendSummary(org.id),
    db.select().from(s.dimensionNodes).where(eq(s.dimensionNodes.orgId, org.id)),
    db.select().from(s.dimensionTypes).where(eq(s.dimensionTypes.orgId, org.id)),
  ]);

  const nodeName = (id: string | null) =>
    id ? nodes.find((n) => n.id === id)?.displayName ?? id : "—";
  const typeName = (id: string | null) =>
    id ? types.find((t) => t.id === id)?.displayName ?? id : "—";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Budgets & Alerts</h1>
        <p className="muted mt-1">
          Scope by org, cost center, team, or feature — thresholds and projected breach dates
        </p>
      </div>

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">Budgets</h2>
        <DataTable
          columns={[
            { key: "name", label: "Name" },
            { key: "scope", label: "Scope" },
            { key: "amount", label: "Amount", align: "right" },
            { key: "period", label: "Period" },
            { key: "thresholds", label: "Thresholds" },
            { key: "mtd", label: "MTD used", align: "right" },
          ]}
          rows={budgets.map((b) => {
            const mtdPct =
              b.scopeType === "org" && summary.budget
                ? summary.budget.mtdPct
                : summary.mtd / Number(b.amount);
            return {
              name: b.name,
              scope:
                b.scopeType === "org"
                  ? "Org"
                  : `${typeName(b.dimensionTypeId)} → ${nodeName(b.dimensionNodeId)}`,
              amount: <Money value={Number(b.amount)} />,
              period: b.period,
              thresholds: (b.thresholds ?? []).map((t) => pct(t, 0)).join(", "),
              mtd: (
                <span style={{ color: mtdPct >= 0.8 ? "var(--warning)" : "var(--text)" }}>
                  {pct(Math.min(mtdPct, 9), 0)}
                </span>
              ),
            };
          })}
        />
      </div>

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">Alerts</h2>
        <DataTable
          columns={[
            { key: "fired", label: "Fired" },
            { key: "threshold", label: "Threshold" },
            { key: "breach", label: "Projected breach" },
            { key: "message", label: "Message" },
          ]}
          rows={alerts.map((a) => ({
            fired: a.firedAt.toISOString().slice(0, 16).replace("T", " "),
            threshold: pct(Number(a.thresholdPct), 0),
            breach: a.projectedBreachDate ?? "—",
            message: a.message,
          }))}
        />
      </div>
    </div>
  );
}
