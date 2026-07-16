import { DataTable } from "@/components/DataTable";
import { getDemoOrg } from "@/lib/queries/org";
import { db } from "@/db";
import * as s from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { SyncButton } from "./SyncButton";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<number, string> = {
  1: "Native API",
  2: "Billing export",
  3: "OTel / push",
  4: "Invoice / seat",
};

export default async function ConnectorsPage() {
  const org = await getDemoOrg();
  if (!org) return <p className="muted">No org — run npm run db:seed</p>;

  const rows = await db
    .select({
      connector: s.connectors,
      provider: s.providers,
    })
    .from(s.connectors)
    .innerJoin(s.providers, eq(s.connectors.providerId, s.providers.id))
    .where(eq(s.connectors.orgId, org.id));

  const runs = await db
    .select()
    .from(s.connectorSyncRuns)
    .orderBy(desc(s.connectorSyncRuns.startedAt))
    .limit(10);

  const covered = rows.reduce(
    (a, r) => a + Number(r.connector.spendCoveredPct ?? 0),
    0
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Connectors</h1>
          <p className="muted mt-1">
            Time-to-first-data — tier badges are honest about fidelity
          </p>
        </div>
        <div className="panel px-3 py-2">
          <span className="muted text-[11px] uppercase">Est. org AI spend covered</span>
          <div className="kpi text-lg">{covered.toFixed(0)}%</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ connector, provider }) => (
          <div key={connector.id} className="panel p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{provider.displayName}</div>
                <div className="muted text-[11px] mono">{provider.key}</div>
              </div>
              <span className={`badge badge-tier${connector.tier}`}>
                Tier {connector.tier}
              </span>
            </div>
            <div className="muted mt-2 text-[11px]">{TIER_LABEL[connector.tier]}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              <div>
                <div className="muted text-[10px] uppercase">Status</div>
                <div
                  style={{
                    color:
                      connector.status === "healthy"
                        ? "var(--accent)"
                        : connector.status === "degraded"
                          ? "var(--warning)"
                          : "var(--muted)",
                  }}
                >
                  {connector.status}
                </div>
              </div>
              <div>
                <div className="muted text-[10px] uppercase">Last sync</div>
                <div className="mono">
                  {connector.lastSyncedAt
                    ? connector.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")
                    : "—"}
                </div>
              </div>
              <div>
                <div className="muted text-[10px] uppercase">Spend covered</div>
                <div className="mono">{Number(connector.spendCoveredPct ?? 0)}%</div>
              </div>
              <div>
                <div className="muted text-[10px] uppercase">Allocated</div>
                <div className="mono">{Number(connector.allocatedPct ?? 0)}%</div>
              </div>
            </div>
            {connector.allocatedByDimension && (
              <div className="muted mt-2 text-[11px]">
                By dim:{" "}
                {Object.entries(
                  connector.allocatedByDimension as Record<string, number>
                )
                  .map(([k, v]) => `${k} ${v}%`)
                  .join(" · ")}
              </div>
            )}
            <p className="muted mt-2 text-[11px]">{connector.healthMessage}</p>
            {[1].includes(connector.tier) &&
              ["anthropic", "openai", "cursor"].includes(provider.key) && (
                <div className="mt-3">
                  <SyncButton provider={provider.key} />
                </div>
              )}
          </div>
        ))}
      </div>

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">Recent sync runs</h2>
        <DataTable
          columns={[
            { key: "started", label: "Started" },
            { key: "phase", label: "Phase" },
            { key: "in", label: "Rows in", align: "right" },
            { key: "out", label: "Written", align: "right" },
          ]}
          rows={runs.map((r) => ({
            started: r.startedAt.toISOString().slice(0, 19).replace("T", " "),
            phase: r.phase,
            in: r.rowsIn,
            out: r.rowsWritten,
          }))}
        />
      </div>

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">OTel GenAI ingest</h2>
        <p className="muted text-[12px]">
          POST <span className="mono">/api/otel/v1/traces</span> with header{" "}
          <span className="mono">x-meter-key: meter_demo_otel_key</span>. Spans use{" "}
          <span className="mono">gen_ai.*</span> attributes and land as UsageEvents — universal
          fallback for gateways (LiteLLM, Portkey, Helicone) and instrumented apps.
        </p>
      </div>
    </div>
  );
}
