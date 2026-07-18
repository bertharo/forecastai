import { DataTable } from "@/components/DataTable";
import { getCurrentOrg } from "@/lib/queries/org";
import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { SyncButton } from "./SyncButton";
import { GatewaySnippets } from "./GatewaySnippets";
import { OtelKeysPanel } from "./OtelKeysPanel";
import { AnthropicKeyForm } from "./AnthropicKeyForm";
import { CodingToolsPanel } from "./CodingToolsPanel";
import { ContributorsPanel } from "./ContributorsPanel";
import { headers } from "next/headers";
import { formatRelativeAgo } from "@/lib/format/relative";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<number, string> = {
  1: "Native API",
  2: "Billing export",
  3: "OTel / push",
  4: "Invoice / seat",
};

export default async function ConnectorsPage() {
  const org = await getCurrentOrg();
  if (!org) return <p className="muted">No org — run npm run db:seed</p>;

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto") || "http";
  const ingestUrl = `${proto}://${host}/api/otel/v1/traces`;

  const rows = await db
    .select({
      connector: s.connectors,
      provider: s.providers,
    })
    .from(s.connectors)
    .innerJoin(s.providers, eq(s.connectors.providerId, s.providers.id))
    .where(eq(s.connectors.orgId, org.id));

  const allRuns = await db
    .select({
      run: s.connectorSyncRuns,
      providerKey: s.providers.key,
    })
    .from(s.connectorSyncRuns)
    .innerJoin(s.connectors, eq(s.connectorSyncRuns.connectorId, s.connectors.id))
    .innerJoin(s.providers, eq(s.connectors.providerId, s.providers.id))
    .where(eq(s.connectors.orgId, org.id))
    .orderBy(desc(s.connectorSyncRuns.startedAt))
    .limit(10);

  const covered = rows.reduce(
    (a, r) => a + Number(r.connector.spendCoveredPct ?? 0),
    0
  );

  const liveCount = rows.filter((r) => r.connector.status === "healthy").length;

  const [githubConn] = await db
    .select()
    .from(s.scmConnections)
    .where(
      and(eq(s.scmConnections.orgId, org.id), eq(s.scmConnections.provider, "github"))
    )
    .limit(1);
  const [{ prCount }] = await db
    .select({ prCount: sql<string>`count(*)` })
    .from(s.pullRequests)
    .where(eq(s.pullRequests.orgId, org.id));
  const [{ contributorCount }] = await db
    .select({ contributorCount: sql<string>`count(*)` })
    .from(s.contributors)
    .where(eq(s.contributors.orgId, org.id));

  return (
    <div className="space-y-5">
      <div className="soft-card" style={{ background: "var(--card-mint)" }}>
        <div
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--muted)" }}
        >
          Data & sources
        </div>
        <p className="mt-2 max-w-3xl text-[16px] font-medium leading-snug">
          This is where Meter learns what you’re spending — upload a file or connect a
          vendor. About <strong>{covered.toFixed(0)}%</strong> of spend is covered ·{" "}
          <strong>{liveCount}</strong> of {rows.length} sources look healthy.
        </p>
        <p className="mt-2 text-[13px]" style={{ color: "#3a4050" }}>
          After Anthropic sync,{" "}
          <a href="/keys" className="underline">
            map API keys to teams
          </a>{" "}
          — spend attribution without changing your apps.
        </p>
      </div>

      <div className="panel p-4">
        <h2 className="mb-1 text-sm font-semibold">Upload a spend file</h2>
        <p className="muted mb-3 text-[13px]">
          Drop in a CSV from Anthropic, OpenAI, or a generic invoice. Home updates once the
          numbers map.
        </p>
        <a className="btn inline-block" href="/import">
          Upload file →
        </a>
      </div>

      <ContributorsPanel count={Number(contributorCount)} />
      <CodingToolsPanel
        github={{
          status: githubConn?.status ?? null,
          accountLogin: githubConn?.accountLogin ?? null,
          lastSyncedAt: githubConn?.lastSyncedAt?.toISOString() ?? null,
          prCount: Number(prCount),
          hasToken: Boolean(githubConn?.credentialsEncrypted),
        }}
      />

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[15px] font-bold">
            Tier 1 <span className="font-medium">Live billing</span>
          </h2>
          <span className="muted text-[13px]">{covered.toFixed(0)}% covered</span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ connector, provider }) => {
          const errored =
            connector.status === "error" ||
            connector.status === "degraded" ||
            Boolean(connector.lastErrorMessage);
          const relative = formatRelativeAgo(connector.lastSyncedAt);
          return (
            <div key={connector.id} className="row-card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{provider.displayName}</div>
                  <div className="muted text-[11px]">{TIER_LABEL[connector.tier]}</div>
                </div>
                <span
                  className="badge"
                  style={{
                    color: errored
                      ? "var(--danger)"
                      : connector.status === "healthy"
                        ? "var(--success)"
                        : connector.status === "stale"
                          ? "var(--warning)"
                          : "var(--muted)",
                    background: errored
                      ? "rgba(196,59,59,0.12)"
                      : connector.status === "healthy"
                        ? "rgba(31,122,69,0.12)"
                        : "rgba(0,0,0,0.05)",
                  }}
                >
                  {errored
                    ? "Sync failed"
                    : connector.status === "healthy"
                      ? "Live"
                      : connector.status}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div>
                  <div className="muted text-[10px] uppercase">Mode</div>
                  <div>{connector.demoMode ? "Demo" : "Live key"}</div>
                </div>
                <div>
                  <div className="muted text-[10px] uppercase">Last sync</div>
                  <div
                    className="font-medium"
                    style={{ color: errored ? "var(--danger)" : undefined }}
                    title={
                      connector.lastSyncedAt
                        ? connector.lastSyncedAt.toISOString()
                        : undefined
                    }
                  >
                    {relative}
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
              {errored && connector.lastErrorMessage && (
                <p
                  className="mt-2 rounded-lg px-2 py-1.5 text-[12px]"
                  style={{
                    background: "rgba(196,59,59,0.08)",
                    color: "var(--danger)",
                  }}
                >
                  {connector.lastErrorMessage}
                </p>
              )}
              {!errored && connector.healthMessage && (
                <p className="muted mt-2 text-[11px]">{connector.healthMessage}</p>
              )}
              {provider.key === "anthropic" && (
                <p className="muted mt-1 text-[11px]">
                  Auto-syncs every 6 hours (Vercel Cron).
                </p>
              )}
              {[1].includes(connector.tier) &&
                ["anthropic", "openai", "cursor"].includes(provider.key) && (
                  <div className="mt-3">
                    <SyncButton provider={provider.key} />
                  </div>
                )}
            </div>
          );
        })}
      </div>

      <AnthropicKeyForm />

      <div className="panel p-3">
        <h2 className="mb-2 text-sm font-medium">Recent sync runs</h2>
        <DataTable
          columns={[
            { key: "provider", label: "Provider" },
            { key: "started", label: "Started" },
            { key: "phase", label: "Phase" },
            { key: "in", label: "Rows in", align: "right" },
            { key: "out", label: "Written", align: "right" },
          ]}
          rows={allRuns.map(({ run, providerKey }) => ({
            provider: providerKey,
            started: run.startedAt.toISOString().slice(0, 19).replace("T", " "),
            phase: run.phase,
            in: run.rowsIn,
            out: run.rowsWritten,
          }))}
        />
      </div>

      <OtelKeysPanel />
      <GatewaySnippets ingestUrl={ingestUrl} />
    </div>
  );
}
