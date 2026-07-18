import Link from "next/link";
import { Money } from "@/components/Money";
import { getCurrentOrg, getDimensionNodes } from "@/lib/queries/org";
import { db } from "@/db";
import * as s from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { pct, usd } from "@/lib/format";
import {
  hierarchyWarnings,
  refreshBudgetSnapshots,
  type BudgetStatus,
} from "@/lib/budgets/status";
import { BudgetActions } from "./BudgetActions";

export const dynamic = "force-dynamic";

function statusCopy(st: BudgetStatus | undefined): {
  label: string;
  color: string;
  detail: string;
} {
  if (!st) {
    return {
      label: "No spend yet",
      color: "var(--muted)",
      detail: "We’ll track burn once bills land this month.",
    };
  }
  if (st.status === "exceeded") {
    return {
      label: "Over budget",
      color: "var(--danger)",
      detail: `Spent ${usd(st.spent)} of ${usd(st.amount)} — ${usd(Math.abs(st.remaining))} over.`,
    };
  }
  if (st.status === "projected-breach") {
    return {
      label: "Likely to go over",
      color: "var(--warning)",
      detail: st.breachDate
        ? `At this pace you may hit the limit around ${st.breachDate}. Month-end outlook ~${usd(st.projectedP50)}.`
        : `Month-end outlook ~${usd(st.projectedP50)} vs a ${usd(st.amount)} limit.`,
    };
  }
  if (st.status === "warn") {
    return {
      label: "Getting close",
      color: "var(--warning)",
      detail: `${pct(st.usedPct, 0)} used · ${usd(st.remaining)} left · pace points to ~${usd(st.projectedP50)} by month end.`,
    };
  }
  return {
    label: "On track",
    color: "var(--success)",
    detail: `${pct(st.usedPct, 0)} used · ${usd(st.remaining)} left · pace looks fine (~${usd(st.projectedP50)} by month end).`,
  };
}

function nextStepCopy(st: BudgetStatus | undefined): string | null {
  if (!st?.policyAction) return null;
  switch (st.policyAction) {
    case "advisory_block":
      return "Suggestion: pause new spend or move work to a cheaper model until next month.";
    case "advisory_downgrade":
      return st.recommendedModel
        ? `Suggestion: try routing more traffic to ${st.recommendedModel} to slow the burn.`
        : "Suggestion: switch some work to a cheaper model.";
    case "require_approval":
      return "Suggestion: require a quick approval before more spend this period.";
    case "notify":
      return "Heads-up sent — no action required yet.";
    default:
      return null;
  }
}

function BurnSpark({
  points,
}: {
  points: { actual: number; proRata: number; p50: number }[];
}) {
  if (points.length < 2) return null;
  const w = 140;
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
    <svg width={w} height={h} className="block" aria-hidden>
      {line("proRata", "var(--muted)")}
      {line("p50", "var(--warning)")}
      {line("actual", "#2f5bd8")}
    </svg>
  );
}

function alertPlain(message: string, policy: string | null, thresh: number) {
  const when = `Hit ${pct(thresh, 0)} of the limit`;
  const action =
    policy === "advisory_block"
      ? "Suggested pausing spend"
      : policy === "advisory_downgrade"
        ? "Suggested a cheaper model"
        : policy === "require_approval"
          ? "Asked for approval"
          : "Sent a heads-up";
  return { when, action, message };
}

export default async function BudgetsPage() {
  const org = await getCurrentOrg();
  if (!org) {
    return (
      <div className="soft-card space-y-3" style={{ background: "var(--card-pink)" }}>
        <p className="text-[18px] font-semibold leading-snug">
          Open a workspace to set spend limits.
        </p>
        <Link href="/onboarding" className="btn inline-block">
          Get started →
        </Link>
      </div>
    );
  }

  const statuses = await refreshBudgetSnapshots(org.id);
  const [alertRows, nodes, versions, warnings, notifications] =
    await Promise.all([
      db
        .select({ alert: s.budgetAlerts })
        .from(s.budgetAlerts)
        .innerJoin(s.budgets, eq(s.budgetAlerts.budgetId, s.budgets.id))
        .where(eq(s.budgets.orgId, org.id))
        .orderBy(desc(s.budgetAlerts.firedAt))
        .limit(20),
      getDimensionNodes(org.id),
      db
        .select({
          ver: s.budgetVersions,
          budgetName: s.budgets.name,
        })
        .from(s.budgetVersions)
        .innerJoin(s.budgets, eq(s.budgetVersions.budgetId, s.budgets.id))
        .where(eq(s.budgets.orgId, org.id))
        .orderBy(desc(s.budgetVersions.createdAt))
        .limit(12),
      hierarchyWarnings(org.id),
      db
        .select()
        .from(s.notifications)
        .where(eq(s.notifications.orgId, org.id))
        .orderBy(desc(s.notifications.createdAt))
        .limit(8),
    ]);
  const alerts = alertRows.map((r) => r.alert);

  const budgets = await db
    .select()
    .from(s.budgets)
    .where(eq(s.budgets.orgId, org.id));

  const statusById = new Map(statuses.map((st) => [st.budgetId, st]));
  const nodeName = (id: string | null) =>
    id ? nodes.find((n) => n.id === id)?.displayName ?? "Team" : "Whole company";

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

  const teamOpts = nodes
    .filter((n) => n.active !== false)
    .map((n) => ({ id: n.id, label: n.displayName }));

  return (
    <div className="space-y-5">
      <div className="soft-card" style={{ background: "var(--card-pink)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          Plan
        </div>
        <p className="mt-2 max-w-2xl text-[18px] font-semibold leading-snug">
          Set a monthly spend limit. We’ll tell you if you’re on track — or about to go over.
        </p>
      </div>

      {warnings.length > 0 && (
        <div
          className="soft-card text-[13px]"
          style={{ background: "#fff6e8", color: "var(--warning)" }}
        >
          <strong>Check your nested limits</strong> —{" "}
          {warnings
            .map(
              (w) =>
                `${w.childName} (${usd(w.childAmount)}) is bigger than parent ${w.parentName} (${usd(w.parentAmount)})`
            )
            .join(" · ")}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="soft-card space-y-2" style={{ background: "var(--card-blue)" }}>
          <div className="text-[15px] font-semibold">No limits yet</div>
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>
            Add a company-wide or team monthly budget below. Once spend is flowing, you’ll
            see burn and heads-ups here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[17px] font-bold">Your limits this month</h2>
              <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
                Blue line = actual spend · gray = even pace · amber = where you’re headed
              </p>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {sorted.map((b) => {
              const st = statusById.get(b.id);
              const copy = statusCopy(st);
              const next = nextStepCopy(st);
              return (
                <div key={b.id} className="soft-card space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[15px] font-semibold">{b.name}</div>
                      <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                        {nodeName(b.dimensionNodeId)} · monthly
                      </div>
                    </div>
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
                      style={{
                        color: copy.color,
                        background: "rgba(0,0,0,0.04)",
                      }}
                    >
                      {copy.label}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                        Spent / limit
                      </div>
                      <div className="text-[22px] font-bold tracking-tight">
                        {st ? (
                          <>
                            <Money value={st.spent} digits={0} />
                            <span
                              className="text-[14px] font-medium"
                              style={{ color: "var(--muted)" }}
                            >
                              {" "}
                              / {usd(Number(b.amount))}
                            </span>
                          </>
                        ) : (
                          usd(Number(b.amount))
                        )}
                      </div>
                    </div>
                    {st && <BurnSpark points={st.burnDown} />}
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: "#3a4050" }}>
                    {copy.detail}
                  </p>
                  {next && (
                    <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                      {next}{" "}
                      <Link href="/scenarios" className="underline">
                        Model a change →
                      </Link>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <BudgetActions
        budgets={budgets.map((b) => ({
          id: b.id,
          name: b.name,
          amount: Number(b.amount),
        }))}
        teams={teamOpts}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="soft-card">
          <div className="text-[13px] font-semibold">Heads-ups</div>
          <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
            When a limit crosses 50%, 80%, or 100% we log it here.
          </p>
          {alerts.length === 0 && notifications.length === 0 ? (
            <p className="mt-4 text-[13px]" style={{ color: "var(--muted)" }}>
              Nothing fired yet — you’re either on track or haven’t set a limit.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {alerts.map((a) => {
                const plain = alertPlain(
                  a.message,
                  a.policyAction,
                  Number(a.thresholdPct)
                );
                return (
                  <li
                    key={a.id}
                    className="border-t pt-3 first:border-0 first:pt-0"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="text-[13px] font-semibold">{plain.when}</div>
                    <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                      {a.firedAt.toISOString().slice(0, 16).replace("T", " ")} ·{" "}
                      {plain.action}
                    </div>
                    <p className="mt-1 text-[13px]">{plain.message}</p>
                  </li>
                );
              })}
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className="border-t pt-3"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="text-[13px] font-semibold">{n.title}</div>
                  <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
                    {n.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[12px]" style={{ color: "var(--muted)" }}>
            Unmapped keys and terminated seats also show on{" "}
            <Link href="/" className="underline">
              Home
            </Link>{" "}
            and{" "}
            <Link href="/allocation" className="underline">
              Alerts
            </Link>
            .
          </p>
        </div>

        <div className="soft-card">
          <div className="text-[13px] font-semibold">Recent changes</div>
          <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
            When someone raises, cuts, or moves a limit.
          </p>
          {versions.length === 0 ? (
            <p className="mt-4 text-[13px]" style={{ color: "var(--muted)" }}>
              No changes yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {versions.map(({ ver, budgetName }) => (
                <li
                  key={ver.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-3 first:border-0 first:pt-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div>
                    <div className="text-[13px] font-semibold">{budgetName}</div>
                    <div className="text-[12px]" style={{ color: "var(--muted)" }}>
                      {ver.changeNote}
                    </div>
                  </div>
                  <div className="text-right text-[13px]">
                    <div className="font-semibold">{usd(Number(ver.amount))}</div>
                    <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                      {ver.effectiveFrom.toISOString().slice(0, 10)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
